//! Explicit, revision-checked folder transfers. Credentials stay in RemarkableState.
use super::*;
use tauri::Manager;
use crate::{files, libraries, projects};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, BTreeSet}, fs, io::Write, path::{Component, Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use uuid::Uuid;
#[path = "remarkable_sync_pdf.rs"]
mod pdf;

#[derive(Default)]
pub struct SyncState(pub Mutex<Option<Pending>>);
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal { #[serde(default)] pdfs: Vec<pdf::PdfMapping>, #[serde(default)] folders: BTreeMap<String, String>, #[serde(default)] files: Vec<Mapping>, #[serde(default)] last_sync: Option<u64>, #[serde(default)] published_folders: BTreeSet<String> }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mapping { path: String, document_id: String, page_id: String, #[serde(default)] local_hash: String, #[serde(default)] remote_hash: String }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncNote { mapping: Mapping, local: Option<files::Note>, remote_hash: Option<String>, remote_data: Option<String>, error: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot { id: String, notes: Vec<SyncNote>, pdfs: Vec<pdf::PdfNote>, journal: Journal }
#[derive(Clone)]
struct WireEntry { hash: String, kind: u64, id: String, count: u64, size: u64 }
#[derive(Clone)]
struct CloudDoc { children: Vec<WireEntry>, metadata: Value }
pub struct Pending { id: String, context: libraries::ProjectContext, project_id: String, link_id: String, root: PathBuf, root_value: Value, entries: Vec<WireEntry>, documents: HashMap<String, CloudDoc>, notes: Vec<SyncNote>, pdfs: Vec<pdf::PdfNote>, journal: Journal, created: Instant }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action { path: String, action: String, content: Option<String>, data: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report { context: libraries::ProjectContext, uploaded: usize, downloaded: usize, unchanged: usize, created_folders: usize, attachments: Vec<String>, conflicts: Vec<String>, warnings: Vec<String> }
fn needs_cloud_write(actions: &[Action], folders: &BTreeMap<String, String>, documents: &HashMap<String, CloudDoc>) -> bool {
    actions.iter().any(|a| a.action == "upload") || folders.values().any(|id| !documents.contains_key(id))
}
fn preserve_root_entries(before: &[WireEntry], after: &[WireEntry]) -> Result<()> {
    if before.iter().any(|entry| !after.iter().any(|current| current.id == entry.id)) {
        return Err("Sync cannot remove cloud files or folders; changes were not committed.".into());
    }
    Ok(())
}
fn hash(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn millis() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn uuid() -> String { Uuid::new_v4().to_string() }
fn wire(text: &str) -> Result<Vec<WireEntry>> {
    parse_index(text)?;
    let skip = if text.lines().next() == Some("4") { 2 } else { 1 };
    text.lines().skip(skip).filter(|s| !s.trim().is_empty()).map(|s| { let p: Vec<_> = s.trim().split(':').collect(); Ok(WireEntry { hash: p[0].into(), kind: p[1].parse().map_err(|_| "Invalid index type")?, id: p[2].into(), count: p[3].parse().map_err(|_| "Invalid index count")?, size: p[4].parse().map_err(|_| "Invalid index size")? }) }).collect()
}
fn index(entries: &[WireEntry], root: bool) -> Vec<u8> {
    let mut sorted = entries.to_vec(); sorted.sort_by(|a, b| a.id.cmp(&b.id));
    let mut text = if root { format!("4\n0:.:{}:{}\n", sorted.len(), sorted.iter().map(|e| e.size).sum::<u64>()) } else { "3\n".into() };
    for e in sorted { text.push_str(&format!("{}:{}:{}:{}:{}\n", e.hash, if root { 0 } else { e.kind }, e.id, e.count, e.size)); }
    text.into_bytes()
}
fn doc_hash(entries: &[WireEntry]) -> Result<String> {
    let mut sorted = entries.to_vec(); sorted.sort_by(|a, b| a.id.cmp(&b.id)); let mut bytes = vec![];
    for e in sorted { for i in (0..64).step_by(2) { bytes.push(u8::from_str_radix(&e.hash[i..i + 2], 16).map_err(|_| "Invalid cloud hash")?); } }
    Ok(hash(&bytes))
}
fn verified_index(bytes: &[u8], expected: &str) -> Result<Vec<WireEntry>> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Invalid notebook index")?;
    let children = wire(text)?;
    let actual = if text.starts_with("4\n") { hash(bytes) } else { doc_hash(&children)? };
    if actual != expected { return Err("Notebook index hash did not match".into()); }
    Ok(children)
}
async fn get(client: &Client, token: &str, entry: &WireEntry) -> Result<Vec<u8>> {
    let filename = if Uuid::parse_str(&entry.id).is_ok() { format!("{}.docSchema", entry.id) } else { entry.id.clone() };
    let bytes = response_bytes(client.get(format!("{SYNC}/sync/v3/files/{}", entry.hash)).bearer_auth(token).header("rm-filename", filename), 16 * 1024 * 1024, "Notebook exceeds the sync limit.").await?;
    if entry.id.contains('.') && hash(&bytes) != entry.hash { return Err("Cloud file hash did not match; sync stopped.".into()); }
    Ok(bytes)
}
async fn root_value(client: &Client, token: &str) -> Result<Value> { parse_json(&response_text(client.get(format!("{SYNC}/sync/v4/root")).bearer_auth(token)).await?) }
fn safe(root: &Path, relative: &str, create_dirs: bool) -> Result<PathBuf> {
    if relative.is_empty() || relative.contains(['\\', ':', '\0']) || Path::new(relative).components().any(|c| !matches!(c, Component::Normal(_))) { return Err("Unsafe sync path.".into()); }
    let mut path = root.to_owned();
    let parts: Vec<_> = Path::new(relative).components().collect();
    for (i, part) in parts.iter().enumerate() { path.push(part); match fs::symlink_metadata(&path) { Ok(meta) if meta.file_type().is_symlink() => return Err("Sync does not follow symbolic links.".into()), Ok(_) => {}, Err(e) if e.kind() == std::io::ErrorKind::NotFound => { if create_dirs && i + 1 < parts.len() { fs::create_dir(&path).map_err(|e| e.to_string())?; } }, Err(e) => return Err(e.to_string()) } }
    Ok(path)
}
fn backup(root: &Path, id: &str, name: &str, bytes: &[u8]) -> Result<()> {
    let path = safe(root, &format!(".notesdive-sync/{id}/{name}"), true)?;
    if path.exists() { if fs::read(&path).map_err(|e| e.to_string())? != bytes { return Err("Sync backup differs from its saved hash.".into()); } return Ok(()); }
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Missing backup folder")?).map_err(|e| e.to_string())?;
    tmp.write_all(bytes).map_err(|e| e.to_string())?; tmp.as_file().sync_all().map_err(|e| e.to_string())?; tmp.persist_noclobber(path).map_err(|e| e.to_string())?; Ok(())
}
fn save_context(app: &tauri::AppHandle, pending: &mut Pending) -> Result<libraries::ProjectContext> {
    let state = app.state::<projects::ProjectState>(); let _guard = state.0.lock().map_err(|e| e.to_string())?;
    let link = pending.context.config.projects.iter_mut().find(|p| p.id == pending.project_id).and_then(|p| p.remarkable_sync.iter_mut().find(|s| s.id == pending.link_id)).ok_or("Sync setup removed")?;
    link.state = serde_json::to_value(&pending.journal).map_err(|e| e.to_string())?;
    let saved = libraries::save(app, pending.context.clone())?; pending.context = saved.clone(); Ok(saved)
}
#[tauri::command]
pub async fn remarkable_sync_snapshot(app: tauri::AppHandle, state: State<'_, RemarkableState>, sync_state: State<'_, SyncState>, project_id: String, link_id: String, library: Option<String>) -> Result<Snapshot> {
    let mut pending_guard = sync_state.0.lock().await;
    if pending_guard.as_ref().is_some_and(|p| p.created.elapsed() < Duration::from_secs(600)) { return Err("Another folder sync is already running.".into()); }
    *pending_guard = None;
    let context = libraries::scoped(&app, library.as_deref())?;
    let project = context.config.projects.iter().find(|p| p.id == project_id && !p.archived).ok_or("Open an active project")?;
    let link = project.remarkable_sync.iter().find(|s| s.id == link_id && s.enabled).ok_or("Turn folder sync on first")?;
    let root = projects::project_root(&context.config, &project_id, &link.local_folder)?;
    let scan_root = if link.path.is_empty() { root.clone() } else { safe(&root, &link.path, false)? };
    if !scan_root.is_dir() { return Err("Local sync folder is unavailable.".into()); }
    let mut journal: Journal = if link.state.is_null() { Journal::default() } else { serde_json::from_value(link.state.clone()).map_err(|_| "Invalid saved sync mappings")? };
    // Never accept arbitrary path/ID access from portable JSON.
    let mut mapped_paths = HashSet::new(); let mut mapped_ids = HashSet::new();
    for m in &journal.files { if !mapped_paths.insert(&m.path) || !mapped_ids.insert(&m.document_id) || (![&m.local_hash, &m.remote_hash].iter().all(|h| h.is_empty() || valid_hash(h))) { return Err("Invalid or duplicate sync file mapping".into()); } safe(&root, &m.path, false)?; if !files::markdown(Path::new(&m.path)) || (!link.path.is_empty() && !m.path.starts_with(&(link.path.clone() + "/"))) || Uuid::parse_str(&m.document_id).is_err() || Uuid::parse_str(&m.page_id).is_err() { return Err("Invalid saved sync file mapping".into()); } }
    pdf::validate_journal(&root, &link.path, &journal.pdfs, &mut mapped_paths, &mut mapped_ids)?;
    for (path, id) in &journal.folders { if !mapped_ids.insert(id) { return Err("Duplicate sync notebook/folder ID".into()); } if path != &link.path && (!link.path.is_empty() && !path.starts_with(&(link.path.clone() + "/"))) { return Err("Sync folder mapping is outside the selected scope".into()); } if !path.is_empty() { safe(&root, path, false)?; } if Uuid::parse_str(id).is_err() { return Err("Invalid saved sync folder ID".into()); } }
    let mut session = state.0.lock().await;
    if session.is_none() { *session = Some(Session::new(load_credential().await?.ok_or("Connect to reMarkable first")?)?); }
    let session = session.as_mut().unwrap(); let client = session.client.clone(); let token = session.token(AUTH).await?;
    let root_value = root_value(&client, &token).await?;
    let root_hash = root_value["hash"].as_str().ok_or("Invalid cloud root")?;
    if !valid_hash(root_hash) { return Err("Invalid cloud root".into()); }
    let root_entry = WireEntry { hash: root_hash.into(), kind: 0, id: "root.docSchema".into(), count: 0, size: 0 };
    let entries = wire(std::str::from_utf8(&get(&client, &token, &root_entry).await?).map_err(|_| "Invalid cloud index")?)?;
    let mut documents = HashMap::new();
    // Fetch indexes/metadata only for the selected destination and owned IDs.
    let owned: HashSet<_> = journal.folders.values().chain(journal.files.iter().map(|m| &m.document_id)).cloned().chain(journal.pdfs.iter().map(|m| m.document_id.clone())).chain(std::iter::once(link.remote_parent_id.clone())).collect();
    for entry in entries.iter().filter(|e| owned.contains(&e.id)) {
        let index_bytes = get(&client, &token, entry).await?;
        let children = verified_index(&index_bytes, &entry.hash)?;
        let meta = children.iter().find(|e| e.id == format!("{}.metadata", entry.id)).ok_or("Missing notebook metadata")?;
        let metadata: Value = serde_json::from_slice(&get(&client, &token, meta).await?).map_err(|_| "Invalid notebook metadata")?;
        documents.insert(entry.id.clone(), CloudDoc { children, metadata });
    }
    let destination = documents.get(&link.remote_parent_id).ok_or("The reMarkable destination is unavailable")?;
    if destination.metadata["type"] != "CollectionType" || flag(&destination.metadata["deleted"]) || destination.metadata["parent"] == "trash" { return Err("The reMarkable destination was removed".into()); }
    for (path, id) in &journal.folders {
        let parent = if path == &link.path { Some(&link.remote_parent_id) } else { journal.folders.get(Path::new(path).parent().unwrap_or(Path::new("")).to_string_lossy().as_ref()) }.ok_or("Missing saved sync folder parent")?;
        if let Some(doc) = documents.get(id) {
            if doc.metadata["type"] != "CollectionType" || doc.metadata["parent"] != *parent || flag(&doc.metadata["deleted"]) { return Err("A synced reMarkable folder moved or was removed. Both sides were left unchanged.".into()); }
        } else if journal.published_folders.contains(id) { return Err("A synced reMarkable folder is unavailable. It was not recreated.".into()); }
    }
    journal.folders.entry(link.path.clone()).or_insert_with(uuid);
    let mut local = BTreeMap::new();
    let mut total_bytes = 0usize;
    for entry in walkdir::WalkDir::new(&scan_root).follow_links(false).into_iter().filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.')) {
        let entry = entry.map_err(|e| e.to_string())?; if entry.file_type().is_symlink() { continue; }
        let relative = entry.path().strip_prefix(&root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() { journal.folders.entry(relative).or_insert_with(uuid); }
        else if entry.file_type().is_file() && files::markdown(entry.path()) {
            if relative.contains(".remarkable-conflict-") { continue; }
            safe(&root, &relative, false)?;
            let note = files::read(&root, &relative)?;
            total_bytes += note.content.len();
            if total_bytes > 32 * 1024 * 1024 { return Err("Select a smaller sync folder (at most 32 MiB of Markdown).".into()); }
            local.insert(relative.clone(), note);
            if !journal.files.iter().any(|m| m.path == relative) { journal.files.push(Mapping { path: relative, document_id: uuid(), page_id: uuid(), local_hash: String::new(), remote_hash: String::new() }); }
        }
        if local.len() > 500 { return Err("Select a sync folder with at most 500 Markdown files.".into()); }
    }
    let mut notes = vec![];
    for mapping in &journal.files {
        let mut note = SyncNote { mapping: mapping.clone(), local: local.remove(&mapping.path), remote_hash: None, remote_data: None, error: None };
        if let Some(doc) = documents.get(&mapping.document_id) {
            let expected_parent = journal.folders.get(Path::new(&mapping.path).parent().unwrap_or(Path::new("")).to_string_lossy().as_ref());
            if flag(&doc.metadata["deleted"]) || doc.metadata["parent"] == "trash" || doc.metadata["parent"].as_str() != expected_parent.map(String::as_str) { note.error = Some("Notebook removed or moved. Neither side was changed.".into()); }
            else {
                let fetched = async {
                    let content = doc.children.iter().find(|e| e.id.ends_with(".content")).ok_or("Missing notebook content")?;
                    let content: Value = serde_json::from_slice(&get(&client, &token, content).await?).map_err(|_| "Invalid notebook content")?;
                    let pages: Vec<String> = if let Some(pages) = content["pages"].as_array() { pages.iter().filter_map(|p| p.as_str().map(str::to_owned)).collect() } else { content["cPages"]["pages"].as_array().map(|p| p.iter().filter_map(|p| p["id"].as_str().map(str::to_owned)).collect()).unwrap_or_default() };
                    if pages != vec![mapping.page_id.clone()] { return Err("Only the original single-page notebook can be synced. Additional pages were kept untouched.".into()); }
                    let page = doc.children.iter().find(|e| e.id == format!("{}/{}.rm", mapping.document_id, mapping.page_id)).ok_or("Missing notebook page")?;
                    let bytes = get(&client, &token, page).await?;
                    total_bytes += bytes.len();
                    if total_bytes > 64 * 1024 * 1024 { return Err("Select a smaller folder (at most 64 MiB per sync run).".into()); }
                    backup(&root, &link.id, &format!("{}-{}.rm", mapping.document_id, page.hash), &bytes)?;
                    Ok((page.hash.clone(), STANDARD.encode(bytes)))
                }.await;
                match fetched { Ok((hash, data)) => { note.remote_hash = Some(hash); note.remote_data = Some(data); }, Err(error) => note.error = Some(error) }
            }
        } else if !mapping.remote_hash.is_empty() { note.error = Some("Notebook is unavailable. Deletions are not mirrored.".into()); }
        notes.push(note);
    }
    let pdfs = pdf::prepare(&root, &scan_root, link, &mut journal, &documents, &client, &token, &mut total_bytes).await?;
    let id = uuid(); let snapshot = Snapshot { id: id.clone(), notes: notes.clone(), pdfs: pdfs.clone(), journal: journal.clone() };
    *pending_guard = Some(Pending { id, context, project_id, link_id, root, root_value, entries, documents, notes, pdfs, journal, created: Instant::now() });
    Ok(snapshot)
}
fn crc32c(bytes: &[u8]) -> u32 { let mut crc = !0u32; for &b in bytes { crc ^= b as u32; for _ in 0..8 { crc = (crc >> 1) ^ if crc & 1 != 0 { 0x82f63b78 } else { 0 }; } } !crc }
async fn put(client: &Client, token: &str, id: &str, bytes: Vec<u8>, digest: String) -> Result<()> {
    response_bytes(client.put(format!("{SYNC}/sync/v3/files/{digest}")).bearer_auth(token).header("rm-filename", id).header("x-goog-hash", format!("crc32c={}", STANDARD.encode(crc32c(&bytes).to_be_bytes()))).header("Content-Type", if id == "root.docSchema" { "text/plain; charset=UTF-8" } else { "application/octet-stream" }).body(bytes), MAX_RESPONSE, "Unexpected cloud response").await?; Ok(())
}
async fn put_file(client: &Client, token: &str, id: String, bytes: Vec<u8>) -> Result<WireEntry> { let digest = hash(&bytes); let size = bytes.len() as u64; put(client, token, &id, bytes, digest.clone()).await?; Ok(WireEntry { id, hash: digest, kind: 0, count: 0, size }) }
async fn put_doc(client: &Client, token: &str, id: String, children: Vec<WireEntry>) -> Result<WireEntry> { let digest = doc_hash(&children)?; let size = children.iter().map(|e| e.size).sum(); let count = children.len() as u64; put(client, token, &format!("{id}.docSchema"), index(&children, false), digest.clone()).await?; Ok(WireEntry { id, hash: digest, kind: 0, count, size }) }
async fn check_root(client: &Client, token: &str, previous: &Value) -> Result<()> { let next = root_value(client, token).await?; if next["hash"] != previous["hash"] || next["generation"] != previous["generation"] { return Err("reMarkable changed during sync. Nothing was overwritten; run sync again.".into()); } Ok(()) }
fn copy_conflict(root: &Path, path: &str, content: &str) -> Result<String> {
    let p = Path::new(path);
    let digest = files::revision(content);
    for i in 0..1000 {
        let suffix = if i == 0 { String::new() } else { format!("-{i}") };
        let name = format!("{}.remarkable-conflict-{}{}.md", p.file_stem().unwrap_or_default().to_string_lossy(), &digest[..12], suffix);
        let relative = p.with_file_name(name).to_string_lossy().into_owned();
        let destination = safe(root, &relative, false)?;
        if destination.exists() {
            if files::read(root, &relative)?.content == content { return Ok(relative); }
            continue; // An edited conflict copy is never replaced.
        }
        files::create(root, &relative, content)?;
        return Ok(relative);
    }
    Err("Too many conflict copies for this note; review existing copies first.".into())
}
#[tauri::command]
pub async fn remarkable_sync_cancel(sync_state: State<'_, SyncState>, id: String) -> Result<()> { let mut s = sync_state.0.lock().await; if s.as_ref().is_some_and(|p| p.id == id) { *s = None; } Ok(()) }
#[tauri::command]
pub async fn remarkable_sync_apply(app: tauri::AppHandle, state: State<'_, RemarkableState>, sync_state: State<'_, SyncState>, id: String, actions: Vec<Action>, pdf_actions: Vec<pdf::PdfAction>) -> Result<Report> {
    let mut guard = sync_state.0.lock().await; if !guard.as_ref().is_some_and(|p| p.id == id) { return Err("Sync snapshot expired; run sync again.".into()); }
    let mut pending = guard.take().unwrap();
    if pending.created.elapsed() > Duration::from_secs(600) { return Err("Sync snapshot expired; run sync again.".into()); }
    if actions.len() != pending.notes.len() { return Err("Incomplete folder sync plan.".into()); }
    let mut paths = HashSet::new();
    for action in &actions {
        let note = pending.notes.iter().find(|n| n.mapping.path == action.path).ok_or("Unknown sync note")?;
        if !paths.insert(&action.path) || !["upload", "download", "conflict", "unchanged", "skip"].contains(&action.action.as_str()) { return Err("Invalid sync action".into()); }
        if action.action != "skip" && (note.error.is_some() || note.local.is_none()) { return Err("Unavailable notes cannot be changed".into()); }
        safe(&pending.root, &action.path, false)?;
        if let Some(local) = &note.local { if files::read(&pending.root, &action.path)?.revision != local.revision { return Err(format!("{} changed during sync; run sync again.", action.path)); } }
        if ["download", "conflict"].contains(&action.action.as_str()) && (note.remote_data.is_none() || action.content.is_none()) { return Err("Missing remote text".into()); }
        if action.action == "upload" { let data = STANDARD.decode(action.data.as_deref().ok_or("Missing notebook data")?).map_err(|_| "Invalid notebook data")?; if data.len() > 16 * 1024 * 1024 || !data.starts_with(b"reMarkable .lines file, version=6          ") { return Err("Invalid v6 notebook data".into()); } }
    }
    pdf::validate_plan(&pending, &pdf_actions)?;
    // Journal the assigned IDs before the first cloud mutation: retries reuse them.
    save_context(&app, &mut pending)?;
    let mut session_guard = state.0.lock().await; let session = session_guard.as_mut().ok_or("Connect to reMarkable first")?;
    let client = session.client.clone(); let token = session.token(AUTH).await?;
    check_root(&client, &token, &pending.root_value).await?;
    let link = pending.context.config.projects.iter().find(|p| p.id == pending.project_id).and_then(|p| p.remarkable_sync.iter().find(|l| l.id == pending.link_id)).ok_or("Sync setup missing")?.clone();
    let mut uploaded = 0; let mut created_folders = 0; let mut upload_hashes = HashMap::new();
    if needs_cloud_write(&actions, &pending.journal.folders, &pending.documents) || pdf::has_uploads(&pending.pdfs, &pdf_actions) {
        let original_entries = pending.entries.clone();
        for (path, folder_id) in &pending.journal.folders {
            let parent = if path == &link.path { link.remote_parent_id.clone() } else { pending.journal.folders.get(Path::new(path).parent().unwrap_or(Path::new("")).to_string_lossy().as_ref()).ok_or("Missing sync folder parent")?.clone() };
            if let Some(doc) = pending.documents.get(folder_id) { if doc.metadata["type"] != "CollectionType" || doc.metadata["parent"] != parent || flag(&doc.metadata["deleted"]) { return Err("A sync folder moved or was removed; it was left unchanged.".into()); } continue; }
            let name = if path.is_empty() { pending.root.file_name().unwrap_or_default().to_string_lossy().into_owned() } else { Path::new(path).file_name().unwrap_or_default().to_string_lossy().into_owned() };
            let metadata = json!({"type":"CollectionType","visibleName":name,"parent":parent,"lastModified":millis().to_string(),"version":1,"deleted":false,"pinned":false,"synced":false});
            let child = put_file(&client, &token, format!("{folder_id}.metadata"), serde_json::to_vec(&metadata).map_err(|e| e.to_string())?).await?;
            let content = put_file(&client, &token, format!("{folder_id}.content"), b"{}".to_vec()).await?;
            let entry = put_doc(&client, &token, folder_id.clone(), vec![child, content]).await?; pending.entries.push(entry); created_folders += 1;
        }
        for action in actions.iter().filter(|a| a.action == "upload") {
            let note = pending.notes.iter().find(|n| n.mapping.path == action.path).unwrap(); let m = &note.mapping;
            let data = STANDARD.decode(action.data.as_ref().unwrap()).map_err(|_| "Invalid notebook data")?; let page_hash = hash(&data);
            let mut children = pending.documents.get(&m.document_id).map(|d| d.children.clone()).unwrap_or_default();
            let page_id = format!("{}/{}.rm", m.document_id, m.page_id);
            let page = put_file(&client, &token, page_id.clone(), data).await?; children.retain(|e| e.id != page_id); children.push(page);
            let parent = pending.journal.folders.get(Path::new(&action.path).parent().unwrap_or(Path::new("")).to_string_lossy().as_ref()).ok_or("Missing notebook parent")?;
            let metadata = if let Some(doc) = pending.documents.get(&m.document_id) { let mut v = doc.metadata.clone(); v["lastModified"] = json!(millis().to_string()); v } else { json!({"type":"DocumentType","visibleName":Path::new(&action.path).file_stem().unwrap_or_default().to_string_lossy(),"parent":parent,"lastModified":millis().to_string(),"version":1,"deleted":false,"pinned":false,"synced":false}) };
            let meta_id = format!("{}.metadata", m.document_id); children.retain(|e| e.id != meta_id); children.push(put_file(&client, &token, meta_id, serde_json::to_vec(&metadata).map_err(|e| e.to_string())?).await?);
            if !pending.documents.contains_key(&m.document_id) {
                let content = json!({"fileType":"notebook","pages":[m.page_id],"pageCount":1,"dummyDocument":false,"fontName":"","lastOpenedPage":0,"lineHeight":-1,"margins":100,"orientation":"portrait","textScale":1,"tags":[],"pageTags":[],"extraMetadata":{}});
                children.push(put_file(&client, &token, format!("{}.content", m.document_id), serde_json::to_vec(&content).map_err(|e| e.to_string())?).await?);
                children.push(put_file(&client, &token, format!("{}.pagedata", m.document_id), b"Blank\n".to_vec()).await?);
            }
            let entry = put_doc(&client, &token, m.document_id.clone(), children).await?; pending.entries.retain(|e| e.id != m.document_id); pending.entries.push(entry); upload_hashes.insert(action.path.clone(), page_hash); uploaded += 1;
        }
        uploaded += pdf::upload(&mut pending, &pdf_actions, &client, &token).await?;
        preserve_root_entries(&original_entries, &pending.entries)?;
        let root_bytes = index(&pending.entries, true); let root_hash = hash(&root_bytes); put(&client, &token, "root.docSchema", root_bytes, root_hash.clone()).await?;
        check_root(&client, &token, &pending.root_value).await?;
        let committed = response_bytes(client.put(format!("{SYNC}/sync/v3/root")).bearer_auth(&token).header("rm-filename", "roothash").json(&json!({"hash":root_hash,"generation":pending.root_value["generation"],"broadcast":true})), MAX_RESPONSE, "Unexpected sync commit response").await?;
        let committed: Value = serde_json::from_slice(&committed).map_err(|_| "Cloud commit outcome uncertain; run sync again with the saved mappings")?;
        if committed["hash"] != root_hash { return Err("Cloud commit outcome uncertain; run sync again with the saved mappings".into()); }
        pending.journal.published_folders.extend(pending.journal.folders.values().filter(|id| pending.entries.iter().any(|e| &e.id == *id)).cloned());
        session.root_hash = None;
    }
    let mut downloaded = 0; let mut unchanged = 0; let mut conflicts = vec![]; let mut warnings = vec![];
    for action in actions {
        let note = pending.notes.iter().find(|n| n.mapping.path == action.path).unwrap(); let mapping = pending.journal.files.iter_mut().find(|m| m.path == action.path).unwrap();
        match action.action.as_str() {
            "skip" => { warnings.push(format!("{}: {}", action.path, action.content.as_deref().or(note.error.as_deref()).unwrap_or("Unavailable file; kept unchanged"))); },
            "conflict" => { let copy = copy_conflict(&pending.root, &action.path, action.content.as_deref().unwrap())?; conflicts.push(copy); },
            "download" => {
                let local = note.local.as_ref().unwrap(); backup(&pending.root, &link.id, &format!("{}-{}.md", mapping.document_id, local.revision), local.content.as_bytes())?;
                match files::save(&pending.root, &action.path, action.content.as_deref().unwrap(), &local.revision) { Ok(saved) => { mapping.local_hash = saved.revision; mapping.remote_hash = note.remote_hash.clone().unwrap(); downloaded += 1; }, Err(error) => { conflicts.push(copy_conflict(&pending.root, &action.path, action.content.as_deref().unwrap())?); warnings.push(error); } }
            },
            "upload" => { mapping.local_hash = note.local.as_ref().unwrap().revision.clone(); mapping.remote_hash = upload_hashes.remove(&action.path).unwrap(); },
            "unchanged" => { mapping.local_hash = note.local.as_ref().unwrap().revision.clone(); mapping.remote_hash = note.remote_hash.clone().ok_or("Missing remote revision")?; unchanged += 1; },
            _ => unreachable!()
        }
    }
    let (pdf_downloaded, pdf_unchanged, attachments, pdf_warnings) = pdf::finish(&mut pending, &pdf_actions)?;
    downloaded += pdf_downloaded; unchanged += pdf_unchanged; warnings.extend(pdf_warnings);
    pending.journal.last_sync = Some(millis());
    let context = save_context(&app, &mut pending)?;
    Ok(Report { context, uploaded, downloaded, unchanged, created_folders, attachments, conflicts, warnings })
}
#[cfg(test)]
mod sync_tests {
    use super::*;
    #[test] fn folders_without_markdown_are_published() {
        let folders = BTreeMap::from([("Facturen".into(), uuid())]);
        assert!(needs_cloud_write(&[], &folders, &HashMap::new()));
        let documents = HashMap::from([(folders["Facturen"].clone(), CloudDoc { children: vec![], metadata: json!({}) })]);
        assert!(!needs_cloud_write(&[], &folders, &documents));
    }
    #[test] fn sync_must_retain_every_existing_cloud_entry() {
        let original = WireEntry { id: uuid(), hash: hash(b"original"), kind: 0, count: 0, size: 8 };
        let added = WireEntry { id: uuid(), hash: hash(b"new"), kind: 0, count: 0, size: 3 };
        assert!(preserve_root_entries(&[original.clone()], &[original.clone(), added.clone()]).is_ok());
        assert!(preserve_root_entries(&[original], &[added]).is_err());
    }
    #[test] fn checksums_and_root_indexes() { assert_eq!(crc32c(b"123456789"), 0xe3069283); let e = WireEntry { hash: hash(b"data"), id: "note".into(), kind: 0, count: 0, size: 4 }; assert_eq!(wire(std::str::from_utf8(&index(&[e], true)).unwrap()).unwrap()[0].size, 4); }
    #[test] fn verifies_both_native_cloud_index_versions() {
        let e = WireEntry { hash: hash(b"metadata"), kind: 0, id: "note.metadata".into(), count: 0, size: 8 };
        let v3 = index(&[e.clone()], false);
        assert!(verified_index(&v3, &doc_hash(&[e.clone()]).unwrap()).is_ok());
        assert!(verified_index(&v3, &hash(&v3)).is_err());
        let v4 = index(&[e], true);
        assert!(verified_index(&v4, &hash(&v4)).is_ok());
        assert!(verified_index(&v4, &"0".repeat(64)).is_err());
    }
    #[test] fn backups_and_conflicts_do_not_overwrite() { let d = tempfile::tempdir().unwrap(); let root = d.path().canonicalize().unwrap(); backup(&root, "test", "page.rm", b"original").unwrap(); assert!(backup(&root, "test", "page.rm", b"other").is_err()); files::create(&root, "note.md", "local").unwrap(); let path = copy_conflict(&root, "note.md", "remote").unwrap(); assert_eq!(files::read(&root, "note.md").unwrap().content, "local"); assert_eq!(files::read(&root, &path).unwrap().content, "remote");
        assert_eq!(copy_conflict(&root, "note.md", "remote").unwrap(), path);
        fs::write(root.join(&path), "reviewed copy").unwrap();
        let next = copy_conflict(&root, "note.md", "remote").unwrap();
        assert_ne!(next, path);
        assert_eq!(files::read(&root, &path).unwrap().content, "reviewed copy");
        assert_eq!(copy_conflict(&root, "note.md", "remote").unwrap(), next); }
    #[cfg(unix)] #[test] fn rejects_symlink_backups() { let d = tempfile::tempdir().unwrap(); let outside = tempfile::tempdir().unwrap(); std::os::unix::fs::symlink(outside.path(), d.path().join(".notesdive-sync")).unwrap(); assert!(backup(d.path(), "test", "page.rm", b"data").is_err()); }
}
