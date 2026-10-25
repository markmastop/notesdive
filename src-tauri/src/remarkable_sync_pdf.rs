//! PDF originals are immutable in the cloud: local revisions get a new document.
//! Tablet scenes are backed up verbatim; no annotation or original is deleted.
use super::*;
const MAX_PDF: usize = 16 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PdfMapping {
    pub document_id: String, pub path: String,
    #[serde(default)] local_hash: String, #[serde(default)] remote_hash: String,
    #[serde(default)] annotation_hash: String,
    #[serde(default)] previous_documents: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PdfNote {
    pub path: String, pub data: Option<String>, pub error: Option<String>,
    #[serde(skip)] local_hash: Option<String>, #[serde(skip)] remote_hash: Option<String>,
    #[serde(skip)] annotation_hash: Option<String>, #[serde(skip)] remote_copy: Option<Vec<u8>>,
    #[serde(skip)] attachments: Vec<String>, #[serde(skip)] version: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAction { path: String, page_count: Option<usize>, error: Option<String> }
fn new_version(mapping: &mut PdfMapping) -> Result<()> {
    if mapping.previous_documents.len() >= 500 { return Err("PDF version limit reached; both versions were kept.".into()); }
    mapping.previous_documents.push(mapping.document_id.clone()); mapping.document_id = uuid();
    mapping.local_hash.clear(); mapping.remote_hash.clear(); mapping.annotation_hash.clear();
    Ok(())
}
fn is_pdf(path: &Path) -> bool { path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("pdf")) }
fn generated_copy(path: &str) -> bool { path.contains(".remarkable-copy-") || path.contains(".annotaties-") }
fn read_pdf(root: &Path, relative: &str) -> Result<Vec<u8>> {
    let path = safe(root, relative, false)?;
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_PDF as u64 { return Err("PDF exceeds the 16 MiB sync limit.".into()); }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PDF || !bytes.starts_with(b"%PDF-") { return Err("Not a supported PDF file.".into()); }
    Ok(bytes)
}
pub(super) fn validate_journal<'a>(root: &Path, scope: &str, pdfs: &'a [PdfMapping], paths: &mut HashSet<&'a String>, ids: &mut HashSet<&'a String>) -> Result<()> {
    if pdfs.len() > 500 { return Err("Too many saved PDF mappings".into()); }
    for m in pdfs {
        safe(root, &m.path, false)?;
        if !is_pdf(Path::new(&m.path)) || generated_copy(&m.path) || (!scope.is_empty() && !m.path.starts_with(&(scope.to_owned() + "/")))
            || !paths.insert(&m.path) || !ids.insert(&m.document_id) || Uuid::parse_str(&m.document_id).is_err()
            || [&m.local_hash, &m.remote_hash, &m.annotation_hash].iter().any(|h| !h.is_empty() && !valid_hash(h))
            || m.previous_documents.len() > 500 || m.previous_documents.iter().any(|id| Uuid::parse_str(id).is_err()) {
            return Err("Invalid saved PDF mapping".into());
        }
    }
    Ok(())
}
pub(super) async fn prepare(root: &Path, scan_root: &Path, link: &projects::RemarkableSyncFolder, journal: &mut Journal, documents: &HashMap<String, CloudDoc>, client: &Client, token: &str, total: &mut usize) -> Result<Vec<PdfNote>> {
    for entry in walkdir::WalkDir::new(scan_root).follow_links(false).into_iter().filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.')) {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().is_file() || !is_pdf(entry.path()) { continue; }
        let relative = entry.path().strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
        if generated_copy(&relative) { continue; }
        if !journal.pdfs.iter().any(|m| m.path == relative) {
            if journal.pdfs.len() >= 500 { return Err("Select a folder with at most 500 PDFs.".into()); }
            journal.pdfs.push(PdfMapping { path: relative, document_id: uuid(), local_hash: String::new(), remote_hash: String::new(), annotation_hash: String::new(), previous_documents: vec![] });
        }
    }
    let mut notes = vec![];
    for m in &mut journal.pdfs {
        let mut note = PdfNote { path: m.path.clone(), data: None, error: None, local_hash: None, remote_hash: None, annotation_hash: None, remote_copy: None, attachments: vec![], version: false };
        let local = match read_pdf(root, &m.path) { Ok(bytes) => bytes, Err(error) => { note.error = Some(format!("{error} Files were kept; deletions are never mirrored.")); notes.push(note); continue; } };
        *total += local.len();
        if *total > 64 * 1024 * 1024 { return Err("Select a smaller folder (64 MiB per sync run).".into()); }
        let local_hash = hash(&local); note.local_hash = Some(local_hash.clone());
        if let Some(doc) = documents.get(&m.document_id) {
            let parent = journal.folders.get(Path::new(&m.path).parent().unwrap_or(Path::new("")).to_string_lossy().as_ref());
            if doc.metadata["type"] != "DocumentType" || flag(&doc.metadata["deleted"]) || doc.metadata["parent"].as_str() != parent.map(String::as_str) {
                note.error = Some("PDF moved or removed on reMarkable; both sides were kept.".into()); notes.push(note); continue;
            }
            let fetched = async {
                let pdf = doc.children.iter().find(|e| e.id == format!("{}.pdf", m.document_id)).ok_or("Missing PDF original on reMarkable")?;
                note.remote_hash = Some(pdf.hash.clone());
                if pdf.hash != local_hash && pdf.hash != m.remote_hash {
                    let bytes = get(client, token, pdf).await?; *total += bytes.len();
                    if *total > 64 * 1024 * 1024 { return Err("PDF download exceeds the folder sync limit.".into()); }
                    if !bytes.starts_with(b"%PDF-") { return Err("Invalid PDF from reMarkable".into()); }
                    note.remote_copy = Some(bytes);
                }
                let mut scene_entries: Vec<_> = doc.children.iter().filter(|e| e.id.ends_with(".rm") || e.id.ends_with(".content")).cloned().collect();
                scene_entries.sort_by(|a, b| a.id.cmp(&b.id));
                let annotation_hash = hash(&index(&scene_entries, false));
                note.annotation_hash = Some(annotation_hash.clone());
                if annotation_hash != m.annotation_hash {
                    backup(root, &link.id, &format!("{}-{}.docSchema", m.document_id, annotation_hash), &index(&scene_entries, false))?;
                    for entry in &scene_entries {
                        let bytes = get(client, token, entry).await?; *total += bytes.len();
                        if *total > 64 * 1024 * 1024 { return Err("PDF annotations exceed the folder sync limit.".into()); }
                        let extension = if entry.id.ends_with(".rm") { "rm" } else { "content" };
                        let name = format!("{}-{}.{}", m.document_id, entry.hash, extension);
                        backup(root, &link.id, &name, &bytes)?;
                        if extension == "rm" { note.attachments.push(format!(".notesdive-sync/{}/{name}", link.id)); }
                    }
                }
                Ok(())
            }.await;
            if let Err(error) = fetched { note.error = Some(error); notes.push(note); continue; }
            if local_hash != m.local_hash && local_hash != note.remote_hash.as_deref().unwrap_or("") {
                // Preserve the complete annotated cloud document. Create a new version instead.
                if let Err(error) = new_version(m) { note.error = Some(error); notes.push(note); continue; }
                note.version = true; note.data = Some(STANDARD.encode(local));
            }
        } else if !m.remote_hash.is_empty() {
            note.error = Some("PDF unavailable on reMarkable. Deletions are never mirrored.".into());
        } else { note.data = Some(STANDARD.encode(local)); }
        if note.data.is_some() && note.error.is_none() { backup(root, &link.id, &format!("{}-{}.pdf", m.document_id, local_hash), &read_pdf(root, &m.path)?)?; }
        notes.push(note);
    }
    Ok(notes)
}
pub(super) fn validate_plan(pending: &Pending, actions: &[PdfAction]) -> Result<()> {
    if actions.len() != pending.pdfs.len() { return Err("Incomplete PDF sync plan".into()); }
    let mut paths = HashSet::new();
    for a in actions {
        let note = pending.pdfs.iter().find(|n| n.path == a.path).ok_or("Unknown PDF sync path")?;
        if !paths.insert(&a.path) { return Err("Duplicate PDF sync path".into()); }
        if let Some(expected) = &note.local_hash { if hash(&read_pdf(&pending.root, &a.path)?) != *expected { return Err(format!("{} changed during sync; run sync again.", a.path)); } }
        if note.data.is_some() && note.error.is_none() && a.error.is_none() && !a.page_count.is_some_and(|n| (1..=300).contains(&n)) { return Err("PDF must have 1–300 readable pages".into()); }
    }
    Ok(())
}
pub(super) fn has_uploads(notes: &[PdfNote], actions: &[PdfAction]) -> bool {
    notes.iter().any(|n| n.data.is_some() && n.error.is_none() && actions.iter().any(|a| a.path == n.path && a.error.is_none()))
}
pub(super) async fn upload(pending: &mut Pending, actions: &[PdfAction], client: &Client, token: &str) -> Result<usize> {
    let mut uploaded = 0;
    for note in &pending.pdfs {
        let action = actions.iter().find(|a| a.path == note.path).unwrap();
        if note.error.is_some() || action.error.is_some() { continue; }
        let Some(data) = &note.data else { continue; };
        let mapping = pending.journal.pdfs.iter_mut().find(|m| m.path == note.path).unwrap();
        let bytes = STANDARD.decode(data).map_err(|_| "Invalid PDF snapshot")?;
        let parent = pending.journal.folders.get(Path::new(&note.path).parent().unwrap_or(Path::new("")).to_string_lossy().as_ref()).ok_or("Missing PDF parent")?;
        let name = Path::new(&note.path).file_stem().unwrap_or_default().to_string_lossy();
        let name = if note.version { format!("{} (NotesDive {})", name, &note.local_hash.as_ref().unwrap()[..8]) } else { name.into_owned() };
        let metadata = json!({"type":"DocumentType","visibleName":name,"parent":parent,"lastModified":millis().to_string(),"version":1,"deleted":false,"pinned":false,"synced":false});
        let content = json!({"fileType":"pdf","pageCount":action.page_count,"originalPageCount":action.page_count,"pages":[],"lastOpenedPage":0,"coverPageNumber":0,"orientation":"portrait","fontName":"","lineHeight":-1,"textScale":1,"margins":100,"tags":[],"extraMetadata":{},"sizeInBytes":bytes.len().to_string()});
        let id = &mapping.document_id;
        let pdf = put_file(client, token, format!("{id}.pdf"), bytes).await?;
        let meta = put_file(client, token, format!("{id}.metadata"), serde_json::to_vec(&metadata).map_err(|e| e.to_string())?).await?;
        let content = put_file(client, token, format!("{id}.content"), serde_json::to_vec(&content).map_err(|e| e.to_string())?).await?;
        let entry = put_doc(client, token, id.clone(), vec![pdf.clone(), meta, content]).await?;
        if pending.entries.iter().any(|e| e.id == *id) { return Err("New PDF ID already exists; sync stopped to preserve it.".into()); }
        pending.entries.push(entry); mapping.local_hash = note.local_hash.clone().unwrap(); mapping.remote_hash = pdf.hash; mapping.annotation_hash.clear(); uploaded += 1;
    }
    Ok(uploaded)
}
fn copy_pdf(root: &Path, path: &str, bytes: &[u8]) -> Result<String> {
    let p = Path::new(path); let digest = hash(bytes);
    for i in 0..1000 {
        let suffix = if i == 0 { String::new() } else { format!("-{i}") };
        let relative = p.with_file_name(format!("{}.remarkable-copy-{}{suffix}.pdf", p.file_stem().unwrap_or_default().to_string_lossy(), &digest[..12])).to_string_lossy().into_owned();
        let destination = safe(root, &relative, false)?;
        if destination.exists() { if fs::read(destination).map_err(|e| e.to_string())? == bytes { return Ok(relative); } continue; }
        let mut tmp = tempfile::NamedTempFile::new_in(destination.parent().ok_or("Missing PDF folder")?).map_err(|e| e.to_string())?;
        tmp.write_all(bytes).map_err(|e| e.to_string())?; tmp.as_file().sync_all().map_err(|e| e.to_string())?; tmp.persist_noclobber(destination).map_err(|e| e.to_string())?;
        return Ok(relative);
    }
    Err("No free name for tablet PDF copy".into())
}
pub(super) fn finish(pending: &mut Pending, actions: &[PdfAction]) -> Result<(usize, usize, Vec<String>, Vec<String>)> {
    let mut downloaded = 0; let mut unchanged = 0; let mut attachments = vec![]; let mut warnings = vec![];
    for note in &pending.pdfs {
        let action = actions.iter().find(|a| a.path == note.path).unwrap();
        if let Some(error) = note.error.as_ref().or(action.error.as_ref()) { warnings.push(format!("{}: {error}", note.path)); continue; }
        if let Some(bytes) = &note.remote_copy { attachments.push(copy_pdf(&pending.root, &note.path, bytes)?); downloaded += 1; }
        attachments.extend(note.attachments.clone());
        if !note.attachments.is_empty() { warnings.push(format!("{}: handwriting saved as original .rm attachments. A PDF with rendered annotations is not available yet.", note.path)); }
        let mapping = pending.journal.pdfs.iter_mut().find(|m| m.path == note.path).unwrap();
        if note.data.is_none() {
            mapping.local_hash = note.local_hash.clone().unwrap();
            if let Some(hash) = &note.remote_hash { mapping.remote_hash = hash.clone(); }
            if let Some(hash) = &note.annotation_hash { mapping.annotation_hash = hash.clone(); }
            if note.remote_copy.is_none() && note.attachments.is_empty() { unchanged += 1; }
        }
    }
    Ok((downloaded, unchanged, attachments, warnings))
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn pdf_revision_keeps_the_old_document_and_journal_round_trips() {
        let original_id = uuid();
        let mut mapping = PdfMapping { document_id: original_id.clone(), path: "read.pdf".into(), local_hash: hash(b"old"), remote_hash: hash(b"remote"), annotation_hash: hash(b"ink"), previous_documents: vec![] };
        new_version(&mut mapping).unwrap();
        assert_ne!(mapping.document_id, original_id);
        assert_eq!(mapping.previous_documents, vec![original_id]);
        assert!(mapping.local_hash.is_empty() && mapping.remote_hash.is_empty());
        let journal = Journal { pdfs: vec![mapping.clone()], ..Journal::default() };
        let restored: Journal = serde_json::from_value(serde_json::to_value(journal).unwrap()).unwrap();
        assert_eq!(restored.pdfs[0].previous_documents, mapping.previous_documents);
        assert_eq!(restored.pdfs[0].document_id, mapping.document_id);
    }
    #[test] fn tablet_pdf_copies_never_overwrite_originals_or_edited_copies() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("note.pdf"), b"%PDF-original").unwrap();
        let copy = copy_pdf(&root, "note.pdf", b"%PDF-remote").unwrap();
        assert_eq!(copy_pdf(&root, "note.pdf", b"%PDF-remote").unwrap(), copy);
        fs::write(root.join(&copy), b"%PDF-user edit").unwrap();
        assert_ne!(copy_pdf(&root, "note.pdf", b"%PDF-remote").unwrap(), copy);
        assert_eq!(fs::read(root.join("note.pdf")).unwrap(), b"%PDF-original");
        assert_eq!(fs::read(root.join(copy)).unwrap(), b"%PDF-user edit");
    }
    #[test] fn exported_copies_are_not_uploaded_again() { assert!(generated_copy("note.remarkable-copy-abc.pdf")); assert!(!generated_copy("note.pdf")); }
    #[test] fn pdf_reader_rejects_invalid_content_and_symlinks() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("bad.pdf"), b"not a PDF").unwrap(); assert!(read_pdf(&root, "bad.pdf").is_err());
        #[cfg(unix)] { std::os::unix::fs::symlink(root.join("bad.pdf"), root.join("link.pdf")).unwrap(); assert!(read_pdf(&root, "link.pdf").is_err()); }
    }
}
