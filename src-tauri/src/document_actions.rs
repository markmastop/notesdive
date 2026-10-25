use std::{fs, path::{Component, Path, PathBuf}, process::Command};
use crate::files::{self, Result};
use tauri::Emitter;
use std::{collections::HashMap, sync::{Mutex, OnceLock}};
static TRASHED: OnceLock<Mutex<HashMap<String, (String, String, PathBuf)>>> = OnceLock::new();
fn trashed() -> &'static Mutex<HashMap<String, (String, String, PathBuf)>> { TRASHED.get_or_init(|| Mutex::new(HashMap::new())) }


fn document(root: &Path, path: &str) -> Result<PathBuf> {
    let relative = Path::new(path);
    if relative.components().any(|c| !matches!(c, Component::Normal(_))) || path.contains('\\')
        || (!files::markdown(relative) && files::asset_mime(relative).is_none()) {
        return Err("Choose a supported document inside your folder.".into());
    }
    let joined = root.join(relative);
    if fs::symlink_metadata(&joined).map_err(|e| e.to_string())?.file_type().is_symlink()
        || !joined.canonicalize().map_err(|e| e.to_string())?.starts_with(root) || !joined.is_file() {
        return Err("Choose a regular document inside your folder.".into());
    }
    Ok(joined)
}
fn rename(root: &Path, path: &str, name: &str) -> Result<String> {
    let old = document(root, path)?;
    if name.trim().is_empty() || name.contains(['/', '\\', ':', '\n', '\r']) || name.starts_with('.')
        || Path::new(name).extension() != old.extension() {
        return Err("Keep the document extension and use a file name without path separators.".into());
    }
    let new = old.with_file_name(name);
    if old == new { return Ok(path.into()); }
    // Creating the new directory entry exclusively never overwrites another document.
    fs::hard_link(&old, &new).map_err(|e| format!("Could not rename document (the name may already exist): {e}"))?;
    if let Err(error) = fs::remove_file(&old) { let _ = fs::remove_file(&new); return Err(error.to_string()); }
    Ok(new.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/"))
}
#[tauri::command]
pub async fn document_action(app: tauri::AppHandle, folder: String, path: String, action: String, name: Option<String>) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::known_root(&app, &folder)?;
        if action == "restore" {
            let mut items = trashed().lock().map_err(|e| e.to_string())?;
            let (original_folder, original_path, trash_file) = items.get(&path).ok_or("This undo is no longer available.")?;
            if original_folder != &folder { return Err("The original folder changed.".into()); }
            let destination = root.join(original_path);
            if !destination.parent().ok_or("Missing folder")?.canonicalize().map_err(|e| e.to_string())?.starts_with(&root) { return Err("Original folder unavailable.".into()); }
            fs::hard_link(trash_file, &destination).map_err(|e| format!("Could not restore document (the name may already exist): {e}"))?;
            if let Err(error) = fs::remove_file(trash_file) { let _ = fs::remove_file(&destination); return Err(error.to_string()); }
            let restored = original_path.clone(); items.remove(&path);
            let _ = app.emit("notes-changed", folder);
            return Ok(restored);
        }
        let file = document(&root, &path)?;
        let result = match action.as_str() {
            "rename" => rename(&root, &path, name.as_deref().ok_or("Enter a document name.")?)?,
            "reveal" => {
                let status = Command::new("/usr/bin/open").arg("-R").arg(&file).status().map_err(|e| e.to_string())?;
                if !status.success() { return Err("Could not show document in Finder.".into()); }
                path.clone()
            },
            "trash" => {
                // Pass the path as an argument, never interpolate user text into AppleScript.
                let script = "on run argv\ntell application \"Finder\"\nset deletedFile to delete ((POSIX file (item 1 of argv)) as alias)\nreturn POSIX path of (deletedFile as alias)\nend tell\nend run";
                let output = Command::new("/usr/bin/osascript").args(["-e", script]).arg(&file).output().map_err(|e| e.to_string())?;
                if !output.status.success() { return Err(format!("Could not move document to Trash: {}", String::from_utf8_lossy(&output.stderr))); }
                let trash_file = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
                if !trash_file.is_absolute() || !trash_file.is_file() { return Err("Document moved to Trash; restore it using Finder.".into()); }
                let token = uuid::Uuid::new_v4().to_string();
                trashed().lock().map_err(|e| e.to_string())?.insert(token.clone(), (folder.clone(), path.clone(), trash_file));
                token
            },
            _ => return Err("Unknown document action.".into()),
        };
        if action != "reveal" { let _ = app.emit("notes-changed", folder); }
        Ok(result)
    }).await.map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rename_preserves_content_and_rejects_overwrites_and_escapes() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("old.md"), "# Keep me").unwrap();
        fs::write(root.join("taken.md"), "Other").unwrap();
        assert!(rename(&root, "old.md", "taken.md").is_err());
        assert!(rename(&root, "old.md", "../escape.md").is_err());
        assert!(rename(&root, "old.md", "other.txt").is_err());
        assert_eq!(rename(&root, "old.md", "new.md").unwrap(), "new.md");
        assert!(!root.join("old.md").exists());
        assert_eq!(fs::read_to_string(root.join("new.md")).unwrap(), "# Keep me");
        assert!(document(&root, "../new.md").is_err());
    }
}
