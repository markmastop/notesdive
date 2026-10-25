//! reMarkable cloud browser and explicitly scoped manual folder sync. Only credentials persist, in the OS keychain.
//! Indexes and metadata live in memory; previews are fetched only when opened.
#[path = "remarkable_sync.rs"]
pub(crate) mod sync;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{stream, StreamExt};
use reqwest::{Client, RequestBuilder, StatusCode};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, time::{Duration, Instant}};
use tauri::{ipc::Channel, State};
use tokio::sync::Mutex;

type Result<T> = std::result::Result<T, String>;
const AUTH: &str = "https://webapp-prod.cloud.remarkable.engineering";
const SYNC: &str = "https://internal.cloud.remarkable.com";
const MAX_RESPONSE: usize = 8 * 1024 * 1024;
const MAX_ITEMS: usize = 20_000;

#[derive(Default)]
pub struct RemarkableState(Mutex<Option<Session>>);
struct Session {
    device_token: String,
    client: Client,
    token: Option<String>,
    root_hash: Option<String>,
    documents: HashMap<String, Document>,
}
impl Session {
    fn new(device_token: String) -> Result<Self> {
        Ok(Self { device_token, client: client()?, token: None, root_hash: None, documents: HashMap::new() })
    }
    async fn token(&mut self, auth: &str) -> Result<String> {
        if let Some(token) = &self.token { return Ok(token.clone()); }
        let token = user_token(&self.client, &self.device_token, auth).await?;
        self.token = Some(token.clone());
        Ok(token)
    }
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress { items: Vec<Item>, loaded: usize, total: usize }
#[derive(Clone)]
struct IndexEntry { hash: String, id: String }
#[derive(Clone)]
struct Document { entry: Item, index: Vec<IndexEntry>, hash: String, content: Option<Value> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    parent: String,
    name: String,
    is_folder: bool,
    modified: Option<u64>,
    pinned: bool,
    revision: String,
    deleted: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing { items: Vec<Item>, warnings: Vec<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail { file_type: String, page_count: Option<u64>, orientation: Option<String>, pages: Vec<String> }
#[derive(Serialize)]
pub struct Preview { mime: &'static str, data: Option<String> }

fn credential() -> Result<keyring::Entry> {
    keyring::Entry::new("app.notesdive.remarkable", "device")
        .map_err(|_| "Could not access the system keychain.".into())
}
async fn load_credential() -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(|| match credential()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Could not read the reMarkable connection. Unlock your system keychain and try again.".into()),
    }).await.map_err(|_| "Could not access the system keychain.")?
}
fn client() -> Result<Client> {
    Client::builder().user_agent("rmapi").timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10)).redirect(reqwest::redirect::Policy::none())
        .build().map_err(|_| "Could not start the reMarkable connection.".into())
}
fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() { "reMarkable took too long to respond. Try refreshing again." }
    else { "Could not reach reMarkable Cloud. Check your internet connection and try again." }.into()
}
async fn response_bytes(request: RequestBuilder, limit: usize, too_large: &str) -> Result<Vec<u8>> {
    let mut response = request.send().await.map_err(network_error)?;
    match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => return Err("reMarkable rejected the connection or pairing code. Disconnect and pair again if needed.".into()),
        StatusCode::TOO_MANY_REQUESTS => return Err("reMarkable is receiving too many requests. Wait a moment before refreshing.".into()),
        StatusCode::NOT_FOUND => return Err("This reMarkable item is no longer available. Refresh the document list.".into()),
        status if !status.is_success() => return Err(format!("reMarkable Cloud returned HTTP {}. Try again later.", status.as_u16())),
        _ => {}
    }
    if response.content_length().is_some_and(|size| size > limit as u64) {
        return Err(too_large.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(network_error)? {
        if bytes.len() + chunk.len() > limit { return Err(too_large.into()); }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn response_text(request: RequestBuilder) -> Result<String> {
    let bytes = response_bytes(request, MAX_RESPONSE, "The reMarkable index is too large to browse.").await?;
    String::from_utf8(bytes).map_err(|_| "reMarkable returned unreadable document information.".into())
}
fn parse_json(text: &str) -> Result<Value> {
    serde_json::from_str(text).map_err(|_| "reMarkable returned unexpected document information.".into())
}
fn valid_hash(hash: &str) -> bool { hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()) }
fn parse_index(text: &str) -> Result<Vec<IndexEntry>> {
    let mut lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    match lines.next() {
        Some("3") => {},
        Some("4") => { if lines.next().is_none() { return Err("Incomplete reMarkable index.".into()); } },
        _ => return Err("This reMarkable cloud index version is not supported yet.".into()),
    }
    let mut entries = Vec::new();
    let mut ids = HashSet::new();
    for line in lines {
        let parts: Vec<_> = line.split(':').collect();
        if parts.len() != 5 || !valid_hash(parts[0]) || parts[2].is_empty()
            || parts[3].parse::<u64>().is_err() || parts[4].parse::<u64>().is_err()
            || !ids.insert(parts[2].to_owned()) {
            return Err("reMarkable returned an invalid document index. Try refreshing.".into());
        }
        entries.push(IndexEntry { hash: parts[0].into(), id: parts[2].into() });
        if entries.len() > MAX_ITEMS { return Err("This reMarkable library has too many items to browse.".into()); }
    }
    Ok(entries)
}
async fn blob(client: &Client, token: &str, entry: &IndexEntry, sync: &str) -> Result<String> {
    if !valid_hash(&entry.hash) { return Err("Invalid reMarkable document reference.".into()); }
    response_text(client.get(format!("{sync}/sync/v3/files/{}", entry.hash))
        .bearer_auth(token).header("rm-filename", &entry.id)).await
        .map_err(|error| format!("Could not read a cloud document index or metadata file: {error}"))
}
// Python requests (used by Planmatic) sends Content-Length: 0 for this POST.
// Match that explicit framing rather than relying on the HTTP client
// defaults for a bodyless POST after device registration succeeds.
fn user_token_request(client: &Client, device: &str, auth_root: &str) -> RequestBuilder {
    client.post(format!("{auth_root}/token/json/2/user/new"))
        .bearer_auth(device)
        .header(reqwest::header::CONTENT_LENGTH, "0")
        .body("")
}
async fn user_token(client: &Client, device: &str, auth: &str) -> Result<String> {
    let token = response_text(user_token_request(client, device, auth)).await
        .map_err(|error| format!("Could not start the cloud session: {error}"))?;
    let token = token.trim();
    if token.is_empty() { return Err("reMarkable returned an empty connection token.".into()); }
    Ok(token.into())
}
fn number(value: &Value) -> Option<u64> { value.as_u64().or_else(|| value.as_str()?.parse().ok()) }
fn flag(value: &Value) -> bool { value.as_bool().unwrap_or_else(|| value.as_str() == Some("true")) }
fn document(entry: &IndexEntry, index: Vec<IndexEntry>, metadata: &Value) -> Document {
    Document { hash: entry.hash.clone(), index, content: None, entry: Item {
        id: entry.id.clone(),
        revision: entry.hash.clone(),
        parent: metadata["parent"].as_str().unwrap_or("").into(),
        name: metadata["visibleName"].as_str().filter(|name| !name.is_empty()).unwrap_or("Untitled").into(),
        is_folder: metadata["type"].as_str() == Some("CollectionType"),
        modified: number(&metadata["lastModified"]),
        pinned: flag(&metadata["pinned"]),
        deleted: flag(&metadata["deleted"]),
    }}
}
// Trash descendants, missing parents and cycles must not leak into the root folder.
fn visible_items(documents: &HashMap<String, Document>) -> Listing {
    let mut items = Vec::new();
    let mut invalid = 0;
    for doc in documents.values() {
        let mut item = &doc.entry;
        let mut seen = HashSet::new();
        loop {
            if item.deleted || item.parent == "trash" { break; }
            if !seen.insert(item.id.as_str()) { invalid += 1; break; }
            if item.parent.is_empty() { items.push(doc.entry.clone()); break; }
            match documents.get(&item.parent) {
                Some(parent) if parent.entry.is_folder => item = &parent.entry,
                _ => { invalid += 1; break; }
            }
        }
    }
    Listing { items, warnings: if invalid > 0 { vec![format!("{invalid} items have unavailable or invalid parent folders and were omitted.")] } else { vec![] } }
}

#[tauri::command]
pub async fn remarkable_status(state: State<'_, RemarkableState>) -> Result<bool> {
    let mut session = state.0.lock().await;
    if session.is_none() {
        if let Some(device_token) = load_credential().await? {
            *session = Some(Session::new(device_token)?);
        }
    }
    Ok(session.is_some())
}
#[tauri::command]
pub async fn remarkable_pair(state: State<'_, RemarkableState>, code: String) -> Result<()> {
    let code = code.trim();
    if code.len() != 8 || !code.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Enter the eight-character code from your reMarkable account.".into());
    }
    let mut session = state.0.lock().await;
    let client = client()?;
    let token = response_text(client.post(format!("{AUTH}/token/json/2/device/new"))
        .header("Authorization", "Bearer")
        .json(&json!({ "code": code, "deviceDesc": "desktop-linux", "deviceID": uuid::Uuid::new_v4().to_string() }))).await
        .map_err(|error| format!("Could not register the device: {error}"))?;
    let token = token.trim().to_owned();
    if token.is_empty() { return Err("reMarkable returned an empty connection token.".into()); }
    // Registration consumes the one-time code. Persist it immediately so a
    // temporary token-exchange failure can be retried without registering again.
    // Cloud authentication is performed by list_documents after this command.
    let stored = token.clone();
    tauri::async_runtime::spawn_blocking(move || credential()?.set_password(&stored)
        .map_err(|_| "Could not save the connection in your system keychain. Unlock it and use a fresh pairing code.".to_string()))
        .await.map_err(|_| "Could not save the reMarkable connection.")??;
    *session = Some(Session::new(token)?);
    Ok(())
}
#[tauri::command]
pub async fn remarkable_disconnect(state: State<'_, RemarkableState>) -> Result<()> {
    let mut session = state.0.lock().await;
    tauri::async_runtime::spawn_blocking(|| match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not remove the connection from your system keychain. Unlock it and try again.".to_owned()),
    }).await.map_err(|_| "Could not remove the reMarkable connection.")??;
    *session = None;
    Ok(())
}
// Only commit a complete snapshot. Progress is disposable and cannot poison the
// root-hash shortcut if a scan is interrupted, fails, or the tab is closed.
async fn list_documents(session: &mut Session, progress: &impl Fn(Progress), auth: &str, sync: &str) -> Result<Listing> {
    for attempt in 0..2 {
        let result = scan_documents(session, progress, auth, sync).await;
        if attempt == 0 && result.as_ref().err().is_some_and(|error| error.contains("reMarkable rejected the connection")) {
            session.token = None;
        } else { return result; }
    }
    unreachable!()
}
async fn scan_documents(session: &mut Session, progress: &impl Fn(Progress), auth: &str, sync: &str) -> Result<Listing> {
    let client = session.client.clone();
    let token = session.token(auth).await?;
    let root = parse_json(&response_text(client.get(format!("{sync}/sync/v4/root")).bearer_auth(&token)).await
        .map_err(|error| format!("Could not read the cloud library: {error}"))?)?;
    let hash = root["hash"].as_str().unwrap_or("");
    if hash.is_empty() && root["generation"].as_u64() == Some(0) {
        session.documents.clear();
        session.root_hash = Some(String::new());
        return Ok(visible_items(&session.documents));
    }
    if !valid_hash(hash) { return Err("Invalid reMarkable library reference.".into()); }
    if session.root_hash.as_deref() == Some(hash) { return Ok(visible_items(&session.documents)); }
    let root_index = blob(&client, &token, &IndexEntry { hash: hash.into(), id: "root.docSchema".into() }, sync).await?;
    let entries = parse_index(&root_index)?;
    let total = entries.len();
    let mut pending = stream::iter(entries.into_iter().map(|entry| {
        let client = client.clone();
        let token = token.clone();
        let existing = session.documents.get(&entry.id).cloned();
        async move {
            if let Some(doc) = existing.as_ref().filter(|doc| doc.hash == entry.hash) { return Ok(doc.clone()); }
            let index_ref = IndexEntry { hash: entry.hash.clone(), id: format!("{}.docSchema", entry.id) };
            let index = parse_index(&blob(&client, &token, &index_ref, sync).await?)?;
            let meta = index.iter().find(|file| file.id.ends_with(".metadata"))
                .ok_or("A reMarkable item has no metadata. Refresh again after your device finishes syncing.")?;
            // Page edits may change the document hash while its name/folder stays the same.
            if let Some(doc) = existing.filter(|doc| doc.index.iter().any(|file| file.id == meta.id && file.hash == meta.hash)) {
                return Ok(Document { entry: doc.entry, index, hash: entry.hash, content: None });
            }
            let metadata = parse_json(&blob(&client, &token, meta, sync).await?)?;
            Ok::<_, String>(document(&entry, index, &metadata))
        }
    })).buffer_unordered(6);
    let mut documents = HashMap::new();
    let mut last_progress = Instant::now();
    while let Some(result) = pending.next().await {
        let doc = result?;
        documents.insert(doc.entry.id.clone(), doc);
        if documents.len() == 1 || documents.len() == total || last_progress.elapsed() >= Duration::from_millis(250) {
            progress(Progress { items: visible_items(&documents).items, loaded: documents.len(), total });
            last_progress = Instant::now();
        }
    }
    drop(pending);
    session.documents = documents;
    session.root_hash = Some(hash.into());
    Ok(visible_items(&session.documents))
}
#[tauri::command]
pub async fn remarkable_list(state: State<'_, RemarkableState>, on_progress: Channel<Progress>) -> Result<Listing> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or("Connect your reMarkable first.")?;
    tokio::time::timeout(Duration::from_secs(120), list_documents(session, &|progress| { let _ = on_progress.send(progress); }, AUTH, SYNC)).await
        .map_err(|_| "Loading the reMarkable library took too long. Try refreshing again.".to_owned())?
}
fn page_ids(content: &Value, index: &[IndexEntry]) -> Vec<String> {
    // Preserve the tablet's page order, including blank pages without a .rm blob.
    let pages = content["cPages"]["pages"].as_array().or_else(|| content["pages"].as_array());
    if let Some(pages) = pages {
        return pages.iter().filter_map(|page| page.as_str().or_else(|| page["id"].as_str()))
            .map(str::to_owned).collect();
    }
    let mut pages: Vec<_> = index.iter().filter_map(|entry| entry.id.rsplit('/').next()?.strip_suffix(".rm"))
        .map(str::to_owned).collect();
    pages.sort();
    pages
}
fn detail(content: &Value) -> Detail {
    let pages = content["cPages"]["pages"].as_array().map(|pages| pages.len() as u64)
        .or_else(|| content["pages"].as_array().map(|pages| pages.len() as u64))
        .or_else(|| number(&content["pageCount"]));
    Detail {
        file_type: content["fileType"].as_str().filter(|s| !s.is_empty()).unwrap_or("notebook").into(),
        page_count: pages,
        orientation: content["orientation"].as_str().map(str::to_owned),
        pages: page_ids(content, &[]),
    }
}
async fn preview_blob(session: &mut Session, entry: &IndexEntry, limit: usize, auth: &str, sync: &str) -> Result<Vec<u8>> {
    if !valid_hash(&entry.hash) { return Err("Invalid reMarkable document reference.".into()); }
    for attempt in 0..2 {
        let token = session.token(auth).await?;
        let result = response_bytes(session.client.get(format!("{sync}/sync/v3/files/{}", entry.hash))
            .bearer_auth(token).header("rm-filename", &entry.id), limit, "This document exceeds the viewer size limit.").await;
        if attempt == 0 && result.as_ref().err().is_some_and(|error| error.contains("reMarkable rejected the connection")) {
            session.token = None;
        } else { return result; }
    }
    unreachable!()
}
async fn load_content(session: &mut Session, id: &str) -> Result<Value> {
    let doc = session.documents.get(id).ok_or("Refresh the reMarkable library first.")?;
    if doc.entry.is_folder { return Err("Select a notebook or document.".into()); }
    if let Some(content) = &doc.content { return Ok(content.clone()); }
    let entry = doc.index.iter().find(|file| file.id.ends_with(".content"))
        .ok_or("This document has no page information.")?.clone();
    let bytes = preview_blob(session, &entry, MAX_RESPONSE, AUTH, SYNC).await?;
    let text = String::from_utf8(bytes).map_err(|_| "reMarkable returned unreadable document information.")?;
    let content = parse_json(&text)?;
    session.documents.get_mut(id).unwrap().content = Some(content.clone());
    Ok(content)
}
#[tauri::command]
pub async fn remarkable_detail(state: State<'_, RemarkableState>, id: String) -> Result<Detail> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or("Connect your reMarkable first.")?;
    let content = load_content(session, &id).await?;
    let mut result = detail(&content);
    result.pages = page_ids(&content, &session.documents[&id].index);
    if result.page_count.is_none() { result.page_count = Some(result.pages.len() as u64); }
    Ok(result)
}
fn preview_entry(doc: &Document, content: &Value, page: Option<usize>) -> Result<Option<IndexEntry>> {
    if let Some(page) = page {
        let pages = page_ids(content, &doc.index);
        let id = pages.get(page).ok_or("This notebook page is no longer available. Refresh the library.")?;
        let filename = format!("{id}.rm");
        return Ok(doc.index.iter().find(|entry| entry.id.rsplit('/').next() == Some(filename.as_str())).cloned());
    }
    let extension = match detail(content).file_type.as_str() {
        "pdf" => ".pdf", "epub" => ".epub", _ => return Err("This document has no supported original file.".into()),
    };
    doc.index.iter().find(|entry| entry.id.ends_with(extension)).cloned().map(Some)
        .ok_or("This document has no original file to display.".into())
}
#[tauri::command]
pub async fn remarkable_preview(state: State<'_, RemarkableState>, id: String, page: Option<usize>) -> Result<Preview> {
    let mut guard = state.0.lock().await;
    let session = guard.as_mut().ok_or("Connect your reMarkable first.")?;
    let content = load_content(session, &id).await?;
    let entry = preview_entry(&session.documents[&id], &content, page)?;
    let mime = if page.is_some() { "application/x-remarkable" } else if detail(&content).file_type == "epub" { "application/epub+zip" } else { "application/pdf" };
    match entry {
        None => Ok(Preview { mime, data: None }), // untouched blank page
        Some(entry) => {
            let limit = if page.is_some() { 20 * 1024 * 1024 } else { 50 * 1024 * 1024 };
            let bytes = preview_blob(session, &entry, limit, AUTH, SYNC).await?;
            Ok(Preview { mime, data: Some(STANDARD.encode(bytes)) })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn entry(id: &str) -> IndexEntry { IndexEntry { id: id.into(), hash: "a".repeat(64) } }
    #[test]
    fn cloud_session_post_has_explicit_zero_length_body() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0; 1];
            while !request.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
                assert!(request.len() < 8192);
            }
            let text = String::from_utf8(request).unwrap().to_ascii_lowercase();
            assert!(text.starts_with("post /token/json/2/user/new http/1.1\r\n"));
            assert!(text.contains("\r\ncontent-length: 0\r\n"));
            assert!(text.contains("\r\nauthorization: bearer fake-device-token\r\n"));
            assert!(!text.contains("transfer-encoding:"));
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\nConnection: close\r\n\r\nfake-user-token").unwrap();
        });
        tauri::async_runtime::block_on(async {
            let token = response_text(user_token_request(&client().unwrap(), "fake-device-token", &origin)).await.unwrap();
            assert_eq!(token, "fake-user-token");
        });
        server.join().unwrap();
    }
    #[test]
    fn incremental_sync_reuses_session_and_metadata_and_preserves_failed_snapshot() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let a = "a".repeat(64); let b = "b".repeat(64); let c = "c".repeat(64);
        let d = "d".repeat(64); let e = "e".repeat(64); let f = "f".repeat(64);
        let root = |hash: &str| json!({"hash":hash,"generation":1}).to_string();
        let steps = vec![
            ("/token/json/2/user/new".into(), 200, "session-one".into()),
            ("/sync/v4/root".into(), 200, root(&a)),
            (format!("/sync/v3/files/{a}"), 200, format!("3\n{b}:80000000:note:1:1\n")),
            (format!("/sync/v3/files/{b}"), 200, format!("3\n{c}:0:note.metadata:0:1\n")),
            (format!("/sync/v3/files/{c}"), 200, json!({"visibleName":"Notebook","parent":""}).to_string()),
            ("/sync/v4/root".into(), 200, root(&a)),
            ("/sync/v4/root".into(), 200, root(&d)),
            (format!("/sync/v3/files/{d}"), 200, format!("3\n{e}:80000000:note:1:1\n")),
            (format!("/sync/v3/files/{e}"), 200, format!("3\n{c}:0:note.metadata:0:1\n")),
            ("/sync/v4/root".into(), 200, root(&f)),
            (format!("/sync/v3/files/{f}"), 200, "broken index".into()),
            ("/sync/v4/root".into(), 401, String::new()),
            ("/token/json/2/user/new".into(), 200, "session-two".into()),
            ("/sync/v4/root".into(), 200, root(&d)),
        ];
        let server = std::thread::spawn(move || {
            for (path, status, body) in steps {
                let deadline = Instant::now() + Duration::from_secs(10);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
                        Err(error) => panic!("Expected request {path}: {error}"),
                    }
                };
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = Vec::new(); let mut byte = [0; 1];
                while !request.ends_with(b"\r\n\r\n") { socket.read_exact(&mut byte).unwrap(); request.push(byte[0]); assert!(request.len() < 8192); }
                let request = String::from_utf8(request).unwrap();
                assert_eq!(request.split_whitespace().nth(1), Some(path.as_str()));
                assert!(!request.contains(".rm"));
                write!(socket, "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            let mut session = Session::new("fake-device".into()).unwrap();
            let progress = std::sync::Mutex::new(Vec::new());
            let report = |value| progress.lock().unwrap().push(value);
            assert_eq!(list_documents(&mut session, &report, &origin, &origin).await.unwrap().items[0].name, "Notebook");
            assert_eq!(progress.lock().unwrap()[0].loaded, 1);
            let count = progress.lock().unwrap().len();
            assert_eq!(list_documents(&mut session, &report, &origin, &origin).await.unwrap().items.len(), 1);
            assert_eq!(progress.lock().unwrap().len(), count); // root-only refresh
            list_documents(&mut session, &report, &origin, &origin).await.unwrap(); // metadata hash unchanged
            assert_eq!(session.documents["note"].hash, e);
            assert!(list_documents(&mut session, &report, &origin, &origin).await.is_err());
            assert_eq!(session.root_hash.as_deref(), Some(d.as_str()));
            assert_eq!(session.documents["note"].entry.name, "Notebook");
            list_documents(&mut session, &report, &origin, &origin).await.unwrap(); // expired token retries once
            assert_eq!(session.token.as_deref(), Some("session-two"));
        });
        server.join().unwrap();
    }
    #[test]
    fn accepts_both_cloud_index_schemas_and_rejects_broken_snapshots() {
        let row = format!("{}:80000000:notebook:2:123\n", "a".repeat(64));
        for header in ["3\n", "4\n0:.:1:123\n"] {
            let result = parse_index(&format!("{header}{row}")).unwrap();
            assert_eq!(result.len(), 1);
            assert_eq!(result[0].id, "notebook");
        }
        for text in ["", "5\n", "4\n", "3\nmalformed", "3\n../../x:0:id:0:1"] { assert!(parse_index(text).is_err()); }
        assert!(parse_index(&format!("3\n{row}{row}")).is_err());
        assert!(parse_index("3\n").unwrap().is_empty());
    }
    #[test]
    fn excludes_trash_descendants_orphans_and_cycles_but_keeps_empty_folders() {
        let mut docs = HashMap::new();
        for (id, parent, folder, deleted) in [
            ("empty", "", true, false), ("folder", "", true, false), ("note", "folder", false, false),
            ("bin", "trash", true, false), ("trashed", "bin", false, false),
            ("deleted", "", true, true), ("child", "deleted", false, false),
            ("orphan", "missing", false, false), ("cycle", "cycle", true, false),
        ] {
            docs.insert(id.into(), document(&entry(id), vec![], &json!({"parent": parent, "deleted": deleted,
                "type": if folder { "CollectionType" } else { "DocumentType" }, "visibleName": id })));
        }
        let listing = visible_items(&docs);
        let mut ids: Vec<_> = listing.items.iter().map(|item| item.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["empty", "folder", "note"]);
        assert_eq!(listing.warnings.len(), 1);
    }
    #[test]
    fn annotation_pages_are_readable_and_cloud_revision_tracks_document_hash() {
        let index = vec![entry("pdf.pdf"), entry("pdf/annotation.rm")];
        let doc = document(&entry("pdf"), index, &json!({"visibleName":"Reading"}));
        let content = json!({"fileType":"pdf", "pages":["annotation", "blank"]});
        assert_eq!(preview_entry(&doc, &content, Some(0)).unwrap().unwrap().id, "pdf/annotation.rm");
        assert!(preview_entry(&doc, &content, Some(1)).unwrap().is_none());
        assert_eq!(doc.entry.revision, doc.hash);
    }
    #[test]
    fn preview_selects_tablet_page_order_and_keeps_blank_pages() {
        let index = vec![IndexEntry { id: "note/second.rm".into(), hash: "b".repeat(64) },
            IndexEntry { id: "note/first.rm".into(), hash: "c".repeat(64) }];
        let content = json!({"cPages":{"pages":[{"id":"first"},{"id":"blank"},{"id":"second"}]}});
        let doc = document(&entry("note"), index, &json!({}));
        assert_eq!(page_ids(&content, &doc.index), vec!["first", "blank", "second"]);
        assert_eq!(preview_entry(&doc, &content, Some(0)).unwrap().unwrap().id, "note/first.rm");
        assert!(preview_entry(&doc, &content, Some(1)).unwrap().is_none());
        assert!(preview_entry(&doc, &content, Some(3)).is_err());
        assert!(preview_entry(&doc, &content, None).is_err());
        assert_eq!(page_ids(&json!({"pages":["second","first"]}), &doc.index), vec!["second", "first"]);
        assert_eq!(page_ids(&json!({"pages":[]}), &doc.index), Vec::<String>::new());
        assert_eq!(page_ids(&json!({}), &doc.index), vec!["first", "second"]);
        let pdf = document(&entry("pdf"), vec![IndexEntry { id: "pdf.pdf".into(), hash: "d".repeat(64) }], &json!({}));
        assert_eq!(preview_entry(&pdf, &json!({"fileType":"pdf"}), None).unwrap().unwrap().id, "pdf.pdf");
        assert!(preview_entry(&pdf, &json!({"fileType":"pdf"}), Some(0)).is_err());
        let epub = document(&entry("epub"), vec![IndexEntry { id: "epub.epub".into(), hash: "e".repeat(64) }], &json!({}));
        assert_eq!(preview_entry(&epub, &json!({"fileType":"epub"}), None).unwrap().unwrap().id, "epub.epub");
    }
    #[test]
    fn viewer_fetches_binary_bytes_with_filename_header_and_enforces_size_limit() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().unwrap();
                socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut bytes = Vec::new(); let mut byte = [0; 1];
                while !bytes.ends_with(b"\r\n\r\n") { socket.read_exact(&mut byte).unwrap(); bytes.push(byte[0]); assert!(bytes.len() < 8192); }
                let request = String::from_utf8(bytes).unwrap().to_ascii_lowercase();
                assert!(request.starts_with(&format!("get /sync/v3/files/{} ", "a".repeat(64))));
                assert!(request.contains("\r\nrm-filename: note/page.rm\r\n"));
                assert!(request.contains("\r\nauthorization: bearer fake-session\r\n"));
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n").unwrap();
                socket.write_all(&[0, 255, 1, 2]).unwrap();
            }
        });
        tauri::async_runtime::block_on(async {
            let mut session = Session::new("fake-device".into()).unwrap();
            session.token = Some("fake-session".into());
            let reference = entry("note/page.rm");
            assert_eq!(preview_blob(&mut session, &reference, 4, &origin, &origin).await.unwrap(), vec![0, 255, 1, 2]);
            assert!(preview_blob(&mut session, &reference, 3, &origin, &origin).await.unwrap_err().contains("size limit"));
        });
        server.join().unwrap();
    }
    #[test]
    fn page_information_supports_old_and_new_notebooks_without_page_blobs() {
        assert_eq!(detail(&json!({"cPages":{"pages":[{"id":"a"},{"id":"b"}]}})).page_count, Some(2));
        assert_eq!(detail(&json!({"pages":["a"],"fileType":"pdf"})).file_type, "pdf");
        assert_eq!(detail(&json!({"pageCount":"3"})).page_count, Some(3));
        assert_eq!(detail(&json!({})).page_count, None);
        assert_eq!(number(&json!("1720000000000")), Some(1720000000000));
    }
}
