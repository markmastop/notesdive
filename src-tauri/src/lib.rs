mod document_actions;
mod files;
mod finder;
mod pdf_export;
mod browser;
mod updates;
mod projects;
mod libraries;
mod remarkable;
use files::{Asset, Listing, Note, Result};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct Workspace { root: PathBuf, _watcher: RecommendedWatcher }
#[derive(Default)]
struct AppState { workspace: Mutex<Option<Workspace>> }
#[derive(Serialize, Deserialize, Clone)]
struct Folder { path: String, name: String }
#[derive(Serialize, Deserialize)]
struct Workspaces { active: String, folders: Vec<Folder> }
#[derive(Deserialize)]
#[serde(untagged)]
enum StoredWorkspaces { Current(Workspaces), Legacy(Folder) }

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("workspace.json"))
}
fn load_workspaces(app: &tauri::AppHandle) -> Result<Option<Workspaces>> {
    let path = config_path(app)?;
    if !path.exists() { return Ok(None); }
    let saved: StoredWorkspaces = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(Some(match saved {
        StoredWorkspaces::Current(config) => config,
        StoredWorkspaces::Legacy(folder) => Workspaces { active: folder.path.clone(), folders: vec![folder] },
    }))
}
fn save_workspaces(app: &tauri::AppHandle, config: &Workspaces) -> Result<()> {
    let path = config_path(app)?;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid config folder")?).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut temp, config).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn activate(app: &tauri::AppHandle, state: &AppState, path: PathBuf) -> Result<Folder> {
    let root = path.canonicalize().map_err(|e| format!("Could not open notes folder: {e}"))?;
    if !root.is_dir() { return Err("Choose a folder.".into()); }
    fs::read_dir(&root).map_err(|e| format!("Could not read folder: {e}"))?;
    let handle = app.clone();
    let watch_root = root.to_string_lossy().into_owned();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        match event {
            Ok(e) if !matches!(e.kind, notify::EventKind::Access(_)) => { let _ = handle.emit("notes-changed", &watch_root); let _ = handle.emit("todo-changed", serde_json::json!({ "folder": &watch_root, "paths": if e.need_rescan() { Vec::<String>::new() } else { e.paths.iter().map(|p| p.to_string_lossy().into_owned()).collect::<Vec<_>>() } })); },
            Err(e) => { let _ = handle.emit("watch-error", e.to_string()); },
            _ => {}
        }
    }).map_err(|e| format!("Could not start file watcher: {e}"))?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| format!("Could not watch folder: {e}"))?;
    let folder = Folder { path: root.to_string_lossy().into_owned(), name: root.file_name().unwrap_or(root.as_os_str()).to_string_lossy().into_owned() };
    let mut config = load_workspaces(app)?.unwrap_or(Workspaces { active: String::new(), folders: vec![] });
    config.folders.retain(|saved| saved.path != folder.path);
    config.folders.insert(0, folder.clone());
    config.active = folder.path.clone();
    save_workspaces(app, &config)?;
    *state.workspace.lock().map_err(|e| e.to_string())? = Some(Workspace { root, _watcher: watcher });
    Ok(folder)
}
#[tauri::command]
async fn restore_workspace(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<Folder>> {
    let Some(config) = load_workspaces(&app)? else { return Ok(None); };
    if config.active.is_empty() { return Ok(None); }
    activate(&app, &state, PathBuf::from(config.active)).map(Some)
}
#[tauri::command]
fn list_workspaces(app: tauri::AppHandle) -> Result<Vec<Folder>> {
    Ok(load_workspaces(&app)?.map(|config| config.folders).unwrap_or_default())
}
#[tauri::command]
fn switch_workspace(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<Folder> {
    let remembered = load_workspaces(&app)?.map(|config| config.folders.iter().any(|folder| folder.path == path)).unwrap_or(false);
    if !remembered && !projects::contains_folder(&app, &path) { return Err("This folder is not in your NotesDive folders.".into()); }
    activate(&app, &state, PathBuf::from(path))
}
#[tauri::command]
fn forget_workspace(app: tauri::AppHandle, state: State<'_, AppState>, path: String) -> Result<Vec<Folder>> {
    let mut config = load_workspaces(&app)?.ok_or("No notes folders have been added yet.")?;
    let was_active = config.active == path;
    if was_active { config.active.clear(); }
    config.folders.retain(|folder| folder.path != path);
    save_workspaces(&app, &config)?;
    if was_active { *state.workspace.lock().map_err(|e| e.to_string())? = None; }
    Ok(config.folders)
}
#[tauri::command]
async fn choose_workspace(app: tauri::AppHandle) -> Result<Option<Folder>> {
    let picker = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || picker.dialog().file().set_title("Choose your notes folder").blocking_pick_folder())
        .await.map_err(|e| e.to_string())?;
    match selected {
        None => Ok(None),
        Some(path) => activate(&app, &app.state::<AppState>(), path.into_path().map_err(|e| e.to_string())?).map(Some)
    }
}
fn in_workspace<T>(state: &AppState, folder: &str, action: impl FnOnce(&std::path::Path) -> Result<T>) -> Result<T> {
    let lock = state.workspace.lock().map_err(|e| e.to_string())?;
    let ws = lock.as_ref().ok_or("Open a notes folder first.")?;
    if ws.root.to_string_lossy() != folder { return Err("The active notes folder changed. Try again.".into()); }
    action(&ws.root)
}
#[tauri::command]
async fn list_notes(app: tauri::AppHandle, folder: String, query: String) -> Result<Listing> {
    tauri::async_runtime::spawn_blocking(move || in_workspace(&app.state::<AppState>(), &folder, |root| files::list(root, &query)))
        .await.map_err(|e| e.to_string())?
}
fn known_root(app: &tauri::AppHandle, folder: &str) -> Result<PathBuf> {
    let remembered = load_workspaces(app)?.map(|config| config.folders.iter().any(|saved| saved.path == folder)).unwrap_or(false);
    if !remembered && !projects::contains_folder(app, folder) { return Err("This folder is not in your NotesDive folders.".into()); }
    checked_root(folder)
}
fn checked_root(folder: &str) -> Result<PathBuf> {
    let root = PathBuf::from(folder);
    let canonical = root.canonicalize().map_err(|e| format!("Folder unavailable: {e}"))?;
    if canonical != root || !canonical.is_dir() { return Err("Folder location changed. Reconnect it in Settings.".into()); }
    Ok(canonical)
}
#[tauri::command]
async fn list_known_notes(app: tauri::AppHandle, folder: String, query: String) -> Result<Listing> {
    tauri::async_runtime::spawn_blocking(move || files::list(&known_root(&app, &folder)?, &query))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_known_note(app: tauri::AppHandle, folder: String, path: String) -> Result<Note> {
    tauri::async_runtime::spawn_blocking(move || files::read(&known_root(&app, &folder)?, &path))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_note(state: State<'_, AppState>, folder: String, path: String) -> Result<Note> {
    in_workspace(&state, &folder, |root| files::read(root, &path))
}
#[tauri::command]
async fn read_marp_theme(app: tauri::AppHandle, folder: String, path: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || in_workspace(&app.state::<AppState>(), &folder, |root| files::read_marp_theme(root, &path)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn read_asset(app: tauri::AppHandle, folder: String, path: String) -> Result<Asset> {
    tauri::async_runtime::spawn_blocking(move || in_workspace(&app.state::<AppState>(), &folder, |root| files::read_asset(root, &path)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_clipboard_image(app: tauri::AppHandle, folder: String, note_path: String, mime: String, data: String) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || in_workspace(&app.state::<AppState>(), &folder, |root| files::save_clipboard_image(root, &note_path, &mime, &data)))
        .await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_note(state: State<'_, AppState>, folder: String, path: String, content: String, revision: String) -> Result<Note> {
    in_workspace(&state, &folder, |root| files::save(root, &path, &content, &revision))
}
#[tauri::command]
async fn create_note(state: State<'_, AppState>, folder: String, path: String, content: String) -> Result<Note> {
    in_workspace(&state, &folder, |root| files::create(root, &path, &content))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(finder::FinderState::default())
        .manage(projects::ProjectState::default())
        .manage(remarkable::RemarkableState::default())
        .manage(remarkable::sync::SyncState::default())
        .invoke_handler(tauri::generate_handler![finder::pending_finder_files, finder::open_finder_file, document_actions::document_action,remarkable::sync::remarkable_sync_snapshot, remarkable::sync::remarkable_sync_apply, remarkable::sync::remarkable_sync_cancel, remarkable::remarkable_status, remarkable::remarkable_pair, remarkable::remarkable_disconnect, remarkable::remarkable_list, remarkable::remarkable_detail, remarkable::remarkable_preview, pdf_export::save_pdf, browser::open_web_link, updates::update_platform, updates::open_release_page, libraries::list_libraries, libraries::library_themes, libraries::read_library_marp_theme, libraries::read_library_marp_image, libraries::choose_library, libraries::switch_library, libraries::forget_library, libraries::import_legacy_projects, projects::load_projects, projects::save_projects, projects::choose_project_folder, projects::list_project_notes, projects::read_project_note, restore_workspace, choose_workspace, list_workspaces, switch_workspace, forget_workspace, list_known_notes, read_known_note, list_notes, read_note, read_marp_theme, read_asset, save_clipboard_image, save_note, create_note])
        .build(tauri::generate_context!())
        .expect("Could not start NotesDive")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { ref urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        app.state::<finder::FinderState>().enqueue(path);
                    }
                }
                let _ = app.emit("finder-files-ready", ());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            // Route the native Quit menu through the same save gate as window close.
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.get_webview_window("main").is_some() {
                    api.prevent_exit();
                    let _ = app.emit("request-close", ());
                }
            }
        });
}

#[cfg(test)]
mod scope_tests {
    use super::*;
    #[test]
    fn registered_roots_must_still_be_the_original_directory() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        assert_eq!(checked_root(root.to_str().unwrap()).unwrap(), root);
        let file = root.join("note.md"); fs::write(&file, "note").unwrap();
        assert!(checked_root(file.to_str().unwrap()).is_err());
        assert!(checked_root(root.join("missing").to_str().unwrap()).is_err());
        #[cfg(unix)] {
            let link = root.join("alias"); std::os::unix::fs::symlink(&root, &link).unwrap();
            assert!(checked_root(link.to_str().unwrap()).is_err());
        }
    }
}
