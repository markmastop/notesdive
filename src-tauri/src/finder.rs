use crate::{activate, files, AppState, Folder};
use files::{Note, Result};
use serde::Serialize;
use std::{fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::{Manager, State};

#[derive(Clone, Serialize)]
pub struct Request { id: String, path: PathBuf }

// Retain launch events until the webview has registered its listener and restored.
#[derive(Default)]
pub struct FinderState(pub Mutex<Vec<Request>>);

impl FinderState {
    pub fn enqueue(&self, path: PathBuf) {
        self.0.lock().unwrap().push(Request { id: uuid::Uuid::new_v4().to_string(), path });
    }
}

#[tauri::command]
pub fn pending_finder_files(state: State<'_, FinderState>) -> Result<Vec<Request>> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

#[derive(Serialize)]
pub struct OpenedFile { folder: Folder, note: Note }

fn prepare(path: &Path, active: Option<&Path>) -> Result<(PathBuf, Note)> {
    if !path.is_absolute() || !files::markdown(path) {
        return Err("Open a .md or .markdown file in NotesDive.".into());
    }
    if fs::symlink_metadata(path).map_err(|e| format!("Cannot open note: {e}"))?.file_type().is_symlink() {
        return Err("Symbolic-link notes are not supported.".into());
    }
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let parent = canonical.parent().ok_or("This note has no parent folder.")?;
    let root = active.filter(|root| canonical.starts_with(root)).unwrap_or(parent);
    let relative = canonical.strip_prefix(root).map_err(|e| e.to_string())?.to_str().ok_or("The note path is not valid UTF-8.")?;
    // Read and validate before switching away from the previous workspace.
    let note = files::read(root, relative)?;
    Ok((root.to_path_buf(), note))
}

#[tauri::command]
pub fn open_finder_file(app: tauri::AppHandle, id: String) -> Result<OpenedFile> {
    // Only paths delivered by the OS may activate an otherwise unknown folder.
    let path = {
        let state = app.state::<FinderState>();
        let mut pending = state.0.lock().map_err(|e| e.to_string())?;
        let index = pending.iter().position(|request| request.id == id).ok_or("This file-open request has expired. Open the file from Finder again.")?;
        pending.remove(index).path
    };
    let state = app.state::<AppState>();
    let active = state.workspace.lock().map_err(|e| e.to_string())?.as_ref().map(|ws| ws.root.clone());
    let (root, note) = prepare(&path, active.as_deref())?;
    let folder = if active.as_ref() == Some(&root) {
        Folder { path: root.to_string_lossy().into_owned(), name: root.file_name().unwrap_or(root.as_os_str()).to_string_lossy().into_owned() }
    } else {
        activate(&app, &state, root)?
    };
    Ok(OpenedFile { folder, note })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_external_unicode_files_in_place_and_reuses_active_roots() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        let path = root.join("nested/Ideeën # 1.MD");
        fs::write(&path, "\u{feff}# Hallo\r\n").unwrap();
        let (folder, note) = prepare(&path, None).unwrap();
        assert_eq!(folder, root.join("nested"));
        assert_eq!(note.path, "Ideeën # 1.MD");
        let saved = files::save(&folder, &note.path, "# Edited", &note.revision).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), saved.content);
        assert_eq!(prepare(&path, Some(&root)).unwrap().1.path, "nested/Ideeën # 1.MD");
    }

    #[test]
    fn rejects_missing_non_markdown_directories_and_invalid_text() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for (name, content) in [("plain.txt", b"text".as_slice()), ("bad.md", &[255])] {
            fs::write(root.join(name), content).unwrap();
            assert!(prepare(&root.join(name), None).is_err());
        }
        assert!(prepare(&root.join("missing.md"), None).is_err());
        fs::create_dir(root.join("folder.md")).unwrap();
        assert!(prepare(&root.join("folder.md"), None).is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(root.join("plain.txt"), root.join("link.md")).unwrap();
            assert!(prepare(&root.join("link.md"), None).is_err());
        }
    }
}
