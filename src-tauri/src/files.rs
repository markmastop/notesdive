use serde::Serialize;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Component, Path, PathBuf}};
use walkdir::WalkDir;

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_ASSET_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_THEME_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note { pub path: String, pub content: String, pub revision: String }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry { pub path: String, pub name: String, pub modified: u64, pub snippet: Option<String> }
#[derive(Serialize)]
pub struct Listing { pub entries: Vec<Entry>, pub directories: Vec<String>, pub warnings: Vec<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset { pub path: String, pub mime: &'static str, pub data: String }

pub fn revision(text: &str) -> String { format!("{:x}", Sha256::digest(text.as_bytes())) }
pub fn markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("md") || s.eq_ignore_ascii_case("markdown"))
}
pub fn asset_mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "epub" => Some("application/epub+zip"),
        "pdf" => Some("application/pdf"),
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "html" | "htm" => Some("text/html"),
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "pptx" => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "txt" => Some("text/plain"),
        _ => None,
    }
}

// Only relative paths inside the active workspace are accepted, including after resolving symlinks.
pub fn resolve(root: &Path, relative: &str, existing: bool) -> Result<PathBuf> {
    let rel = Path::new(relative);
    if relative.is_empty() || relative.contains('\\') || rel.components().any(|c| !matches!(c, Component::Normal(_))) || !markdown(rel) {
        return Err("Use a relative Markdown path inside your notes folder.".into());
    }
    let joined = root.join(rel);
    let checked = if existing { fs::canonicalize(&joined) } else { fs::canonicalize(joined.parent().ok_or("Invalid parent folder")?) }
        .map_err(|e| format!("Cannot access {relative}: {e}"))?;
    if !checked.starts_with(root) { return Err("This path points outside your notes folder.".into()); }
    if existing && fs::symlink_metadata(&joined).map_err(|e| e.to_string())?.file_type().is_symlink() {
        return Err("Symbolic-link notes are not supported.".into());
    }
    Ok(joined)
}

fn text(path: &Path) -> Result<String> {
    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    if !f.metadata().map_err(|e| e.to_string())?.is_file() { return Err("This is not a regular file.".into()); }
    let mut data = Vec::new();
    f.take(MAX_BYTES + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() as u64 > MAX_BYTES { return Err("This note exceeds the 20 MiB limit.".into()); }
    String::from_utf8(data).map_err(|_| "This note is not valid UTF-8 text.".into())
}

pub fn read(root: &Path, relative: &str) -> Result<Note> {
    let content = text(&resolve(root, relative, true)?)?;
    Ok(Note { path: relative.into(), revision: revision(&content), content })
}
pub fn read_marp_theme(root: &Path, relative: &str) -> Result<String> {
    let rel = Path::new(relative);
    if relative.is_empty() || relative.contains('\\') || rel.components().any(|c| !matches!(c, Component::Normal(_)))
        || !rel.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("css")) {
        return Err("Use a relative CSS theme path inside your notes folder.".into());
    }
    let joined = root.join(rel);
    let checked = fs::canonicalize(&joined).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        format!("Theme file not found: {relative}")
    } else { format!("Cannot access {relative}: {e}") })?;
    if !checked.starts_with(root) { return Err("This path points outside your notes folder.".into()); }
    if fs::symlink_metadata(&joined).map_err(|e| e.to_string())?.file_type().is_symlink() {
        return Err("Symbolic-link themes are not supported.".into());
    }
    let file = fs::File::open(&joined).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("This is not a regular file.".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_THEME_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_THEME_BYTES { return Err("This theme exceeds the 16 MiB limit. Reduce embedded images or store them beside the CSS file.".into()); }
    String::from_utf8(bytes).map_err(|_| "This theme is not valid UTF-8 CSS.".into())
}
pub fn read_asset(root: &Path, relative: &str) -> Result<Asset> {
    let rel = Path::new(relative);
    let mime = asset_mime(rel).ok_or("Choose a supported file to view.")?;
    if relative.is_empty() || relative.contains('\\') || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Use a relative file path inside your notes folder.".into());
    }
    let joined = root.join(rel);
    let checked = fs::canonicalize(&joined).map_err(|e| format!("Cannot access {relative}: {e}"))?;
    if !checked.starts_with(root) { return Err("This path points outside your notes folder.".into()); }
    if fs::symlink_metadata(&joined).map_err(|e| e.to_string())?.file_type().is_symlink() {
        return Err("Symbolic-link files are not supported.".into());
    }
    let file = fs::File::open(&joined).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("This is not a regular file.".into()); }
    let mut bytes = Vec::new();
    file.take(MAX_ASSET_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_ASSET_BYTES { return Err("This file exceeds the 50 MiB viewer limit.".into()); }
    Ok(Asset { path: relative.into(), mime, data: base64::engine::general_purpose::STANDARD.encode(bytes) })
}

pub fn save_clipboard_image(root: &Path, note_path: &str, mime: &str, data: &str) -> Result<String> {
    let note = resolve(root, note_path, true)?;
    if fs::metadata(&note).map_err(|e| e.to_string())?.permissions().readonly() {
        return Err("This note is read-only.".into());
    }
    if data.len() as u64 > MAX_ASSET_BYTES * 4 / 3 + 4 { return Err("This image exceeds the 50 MiB limit.".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "Invalid image data.")?;
    let extension = match mime {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => "png",
        "image/jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => "jpg",
        _ => return Err("Paste a PNG or JPEG image.".into()),
    };
    if bytes.len() as u64 > MAX_ASSET_BYTES { return Err("This image exceeds the 50 MiB limit.".into()); }
    let directory = note.parent().ok_or("Invalid note folder")?;
    let mut temp = tempfile::Builder::new().prefix("image-").suffix(&format!(".{extension}")).tempfile_in(directory).map_err(|e| e.to_string())?;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    let (_, path) = temp.keep().map_err(|e| e.to_string())?;
    Ok(path.file_name().ok_or("Invalid image name")?.to_string_lossy().into_owned())
}

pub fn save(root: &Path, relative: &str, content: &str, expected: &str) -> Result<Note> {
    if content.len() as u64 > MAX_BYTES { return Err("This note exceeds the 20 MiB limit.".into()); }
    let path = resolve(root, relative, true)?;
    let current = text(&path)?;
    if revision(&current) != expected { return Err("CONFLICT: This note changed on disk. Reload it or save your draft as a copy.".into()); }
    let permissions = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
    if permissions.readonly() { return Err("This note is read-only.".into()); }
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid parent folder")?).map_err(|e| e.to_string())?;
    temp.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    temp.as_file().set_permissions(permissions).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    // Check again after preparing the replacement, narrowing the external-edit race.
    if revision(&text(&path)?) != expected { return Err("CONFLICT: This note changed while saving.".into()); }
    temp.persist(&path).map_err(|e| format!("Could not save note: {}", e.error))?;
    Ok(Note { path: relative.into(), content: content.into(), revision: revision(content) })
}

pub fn create(root: &Path, relative: &str, content: &str) -> Result<Note> {
    if content.len() as u64 > MAX_BYTES { return Err("This note exceeds the 20 MiB limit.".into()); }
    // Portable names, including on Windows. Subfolders must already exist.
    for part in relative.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty() || part.ends_with(['.', ' ']) || part.chars().any(|c| c.is_control() || "<>:\"\\|?*".contains(c))
            || ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
            || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && matches!(stem.as_bytes()[3], b'1'..=b'9')) {
            return Err("Choose a valid cross-platform filename.".into());
        }
    }
    let path = resolve(root, relative, false)?;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid parent folder")?).map_err(|e| e.to_string())?;
    temp.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist_noclobber(&path).map_err(|e| format!("Cannot create note (the name may already exist): {}", e.error))?;
    Ok(Note { path: relative.into(), revision: revision(content), content: content.into() })
}

pub fn list(root: &Path, query: &str) -> Result<Listing> {
    if !root.is_dir() { return Err("Your notes folder is no longer available. Reconnect it or choose another folder.".into()); }
    let mut result = Listing { entries: vec![], directories: vec![], warnings: vec![] };
    let query = query.trim().to_lowercase();
    for item in WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
        e.depth() == 0 || !e.file_type().is_dir() ||
            (!matches!(e.file_name().to_str(), Some(".git" | "node_modules" | ".obsidian" | ".trash" | ".notesdive-sync")) &&
             !(e.file_name() == "notesdive-library" && e.path().join("library.json").is_file()))
    }) {
        let item = match item { Ok(v) => v, Err(e) => { if result.warnings.len() < 10 { result.warnings.push(e.to_string()); } continue; } };
        if item.depth() > 0 && item.file_type().is_dir() {
            result.directories.push(item.path().strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/"));
            continue;
        }
        if !item.file_type().is_file() || !(markdown(item.path()) || asset_mime(item.path()).is_some()) { continue; }
        let path = item.path().strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
        let mut snippet = None;
        if !query.is_empty() && !path.to_lowercase().contains(&query) {
            if !markdown(item.path()) { continue; }
            match text(item.path()) {
                Ok(content) => {
                    if let Some(line) = content.lines().find(|l| l.to_lowercase().contains(&query)) {
                        snippet = Some(line.trim().chars().take(180).collect());
                    } else { continue; }
                },
                Err(e) => { if result.warnings.len() < 10 { result.warnings.push(format!("{path}: {e}")); } continue; }
            }
        }
        let modified = item.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
        result.entries.push(Entry { path, name: item.file_name().to_string_lossy().into(), modified, snippet });
    }
    result.entries.sort_by_key(|e| e.path.to_lowercase());
    result.directories.sort();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lists_empty_directories_and_tracks_creation_rename_and_removal() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        assert!(list(&root, "").unwrap().directories.is_empty());
        fs::create_dir_all(root.join("New/Nested")).unwrap();
        fs::create_dir_all(root.join(".git/Hidden")).unwrap();
        fs::create_dir_all(root.join("node_modules/Hidden")).unwrap();
        fs::write(root.join("New/Nested/unsupported.bin"), b"binary").unwrap();
        let listing = list(&root, "no matching documents").unwrap();
        assert_eq!(listing.directories, vec!["New", "New/Nested"]);
        assert!(listing.entries.is_empty());
        fs::rename(root.join("New"), root.join("Renamed")).unwrap();
        assert_eq!(list(&root, "").unwrap().directories, vec!["Renamed", "Renamed/Nested"]);
        fs::remove_dir_all(root.join("Renamed")).unwrap();
        assert!(list(&root, "").unwrap().directories.is_empty());
        #[cfg(unix)] {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.join("Linked")).unwrap();
            assert!(list(&root, "").unwrap().directories.is_empty());
        }
    }
    #[test]
    fn clipboard_images_stay_beside_notes_without_overwrites() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("Ideas")).unwrap();
        create(&root, "Ideas/Note.md", "text").unwrap();
        let bytes = b"\x89PNG\r\n\x1a\nimage";
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        let first = save_clipboard_image(&root, "Ideas/Note.md", "image/png", &data).unwrap();
        let second = save_clipboard_image(&root, "Ideas/Note.md", "image/png", &data).unwrap();
        assert_ne!(first, second);
        assert!(!first.contains('/'));
        assert!(!root.join("Ideas/attachments").exists());
        assert_eq!(fs::read(root.join("Ideas").join(first)).unwrap(), bytes);
        assert_eq!(read(&root, "Ideas/Note.md").unwrap().content, "text");
        assert!(save_clipboard_image(&root, "../Note.md", "image/png", &data).is_err());
        assert!(save_clipboard_image(&root, "Ideas/Note.md", "image/png", "aGVsbG8=").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn clipboard_images_reject_notes_outside_the_workspace() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("Note.md"), "text").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("Linked")).unwrap();
        let data = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG\r\n\x1a\nimage");
        assert!(save_clipboard_image(&root, "Linked/Note.md", "image/png", &data).is_err());
        assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 1);
    }
    #[test]
    fn nested_search_and_case_insensitive_extensions() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("Ideas")).unwrap();
        create(&root, "Ideas/Hello.MD", "# Café\nA quiet ocean").unwrap();
        fs::write(root.join("ignored.txt"), "ocean").unwrap();
        assert_eq!(list(&root, "OCEAN").unwrap().entries.len(), 1);
        assert_eq!(list(&root, "hello").unwrap().entries.len(), 1);
        assert_eq!(read(&root, "Ideas/Hello.MD").unwrap().content, "# Café\nA quiet ocean");
    }
    #[test]
    fn reads_only_bounded_utf8_css_themes_inside_the_workspace() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("themes")).unwrap();
        fs::write(root.join("themes/workshop.css"), "/* @theme workshop */\nsection { color: navy; }").unwrap();
        assert!(read_marp_theme(&root, "themes/workshop.css").unwrap().contains("navy"));
        assert!(read_marp_theme(&root, "../workshop.css").is_err());
        assert!(read_marp_theme(&root, "/workshop.css").is_err());
        assert!(read_marp_theme(&root, "themes/workshop.md").is_err());
        fs::write(root.join("themes/invalid.css"), [0xff]).unwrap();
        assert!(read_marp_theme(&root, "themes/invalid.css").is_err());
        fs::write(root.join("themes/large.css"), vec![b' '; MAX_THEME_BYTES as usize]).unwrap();
        assert_eq!(read_marp_theme(&root, "themes/large.css").unwrap().len(), MAX_THEME_BYTES as usize);
        fs::write(root.join("themes/large.css"), vec![b' '; MAX_THEME_BYTES as usize + 1]).unwrap();
        assert!(read_marp_theme(&root, "themes/large.css").unwrap_err().contains("exceeds the 16 MiB limit"));
        assert!(read_marp_theme(&root, "themes/missing.css").unwrap_err().starts_with("Theme file not found:"));
    }
    #[cfg(unix)]
    #[test]
    fn themes_reject_symbolic_links_and_external_directories() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("outside.css"), "/* @theme outside */").unwrap();
        std::os::unix::fs::symlink(outside.path().join("outside.css"), root.join("linked.css")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("themes")).unwrap();
        assert!(read_marp_theme(&root, "linked.css").is_err());
        assert!(read_marp_theme(&root, "themes/outside.css").is_err());
    }
    #[test]
    fn hides_nested_project_library_from_notes_listing() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        let library = root.join("notesdive-library");
        fs::create_dir(&library).unwrap();
        fs::write(library.join("library.json"), "{}").unwrap();
        fs::write(library.join("README.md"), "project notes").unwrap();
        fs::write(root.join("Visible.md"), "visible note").unwrap();
        fs::create_dir(root.join(".notesdive-sync")).unwrap();
        fs::write(root.join(".notesdive-sync/backup.md"), "hidden sync backup").unwrap();
        assert_eq!(list(&root, "").unwrap().entries.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["Visible.md"]);
        assert!(list(&root, "project notes").unwrap().entries.is_empty());
        assert_eq!(list(&library, "").unwrap().entries.len(), 1);
        fs::remove_file(library.join("library.json")).unwrap();
        assert_eq!(list(&root, "").unwrap().entries.len(), 2);
    }
    #[test]
    fn stale_saves_and_duplicate_creation_preserve_disk() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        let note = create(&root, "note.md", "first\r\n").unwrap();
        assert!(create(&root, "note.md", "overwrite").is_err());
        fs::write(root.join("note.md"), "external").unwrap();
        assert!(save(&root, "note.md", "draft", &note.revision).unwrap_err().starts_with("CONFLICT:"));
        assert_eq!(read(&root, "note.md").unwrap().content, "external");
        let saved = save(&root, "note.md", "new\r\n", &revision("external")).unwrap();
        assert_eq!(saved.content, fs::read_to_string(root.join("note.md")).unwrap());
    }
    #[test]
    fn rejects_escape_and_invalid_names() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        for name in ["../escape.md", "/tmp/escape.md", "a\\b.md", "CON.md", "bad?.md", "note.txt"] {
            assert!(create(&root, name, "x").is_err(), "{name}");
        }
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape_workspace() {
        let dir = tempfile::tempdir().unwrap(); let other = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(other.path().join("secret.md"), "private").unwrap();
        std::os::unix::fs::symlink(other.path(), root.join("linked")).unwrap();
        assert!(read(&root, "linked/secret.md").is_err());
        assert!(create(&root, "linked/new.md", "x").is_err());
        assert!(list(&root, "").unwrap().entries.is_empty());
    }
    #[test]
    fn deletion_and_invalid_utf8_are_reported() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("bad.md"), [0xff]).unwrap();
        assert!(read(&root, "bad.md").is_err());
        assert!(save(&root, "missing.md", "draft", "old").is_err());
    }
    #[test]
    fn lists_viewable_files_but_only_reads_allowed_assets_inside_workspace() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("figure.SVG"), b"<svg/>").unwrap();
        fs::write(root.join("book.epub"), b"zip").unwrap();
        fs::write(root.join("paper.pdf"), b"%PDF-1.4").unwrap();
        fs::write(root.join("photo.JPG"), [1, 2, 3]).unwrap();
        fs::write(root.join("readme.txt"), b"plain text").unwrap();
        fs::write(root.join("ignored.bin"), b"not supported").unwrap();
        fs::write(root.join("page.html"), b"<h1>Hello</h1>").unwrap();
        fs::write(root.join("notes.docx"), b"office").unwrap();
        fs::write(root.join("slides.pptx"), b"office").unwrap();
        assert_eq!(list(&root, "").unwrap().entries.len(), 8);
        assert_eq!(list(&root, "paper").unwrap().entries.len(), 1);
        assert!(list(&root, "plain text").unwrap().entries.is_empty());
        assert_eq!(read_asset(&root, "book.epub").unwrap().mime, "application/epub+zip");
        assert_eq!(read_asset(&root, "figure.SVG").unwrap().mime, "image/svg+xml");
        assert_eq!(read_asset(&root, "page.html").unwrap().mime, "text/html");
        assert_eq!(read_asset(&root, "notes.docx").unwrap().mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        assert_eq!(read_asset(&root, "slides.pptx").unwrap().mime, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        assert_eq!(read_asset(&root, "readme.txt").unwrap().mime, "text/plain");
        assert!(read_asset(&root, "../paper.pdf").is_err());
        assert!(read_asset(&root, "ignored.bin").is_err());
        assert!(read(&root, "paper.pdf").is_err());
    }
}
