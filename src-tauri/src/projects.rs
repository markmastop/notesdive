use crate::{files, load_workspaces, save_workspaces, Folder, Workspaces};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::{Path, PathBuf}, sync::Mutex};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemarkableFolderLink { pub id: String, pub name: String }

/// Explicit folder scope and portable sync journal.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemarkableSyncFolder {
    pub id: String, pub local_folder: String, pub path: String,
    pub remote_parent_id: String, pub enabled: bool,
    #[serde(default)] pub state: serde_json::Value,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    #[serde(default = "default_project_icon")]
    pub icon: String,
    pub pinned: bool,
    pub archived: bool,
    pub folders: Vec<String>,
    pub default_folder: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remarkable_folders: Vec<RemarkableFolderLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remarkable_sync: Vec<RemarkableSyncFolder>,
}
#[derive(Default, Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Projects {
    pub active: Option<String>,
    pub projects: Vec<Project>,
}
#[derive(Default)]
pub struct ProjectState(pub Mutex<()>);
pub(crate) fn default_project_icon() -> String { "folder".into() }

pub(crate) fn config_path(app: &tauri::AppHandle) -> files::Result<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("projects.json"))
}
pub(crate) fn load(path: &Path) -> files::Result<Projects> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Could not read projects: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Projects::default()),
        Err(e) => Err(e.to_string()),
    }
}
pub(crate) fn validate(config: &Projects, allowed: &HashSet<String>) -> files::Result<()> {
    let mut ids = HashSet::new();
    for project in &config.projects {
        if project.id.is_empty() || !ids.insert(&project.id) { return Err("Project IDs must be unique.".into()); }
        if project.name.trim().is_empty() || project.name.chars().count() > 200 { return Err("Give the project a name of up to 200 characters.".into()); }
        if !["sage", "forest", "teal", "cyan", "blue", "violet", "lavender", "rose", "coral", "orange", "amber", "graphite"].contains(&project.color.as_str()) { return Err("Choose a project color.".into()); }
        if !["folder", "briefcase", "education", "book", "research", "code", "idea", "building", "heart", "partners", "leaf", "rocket", "sports", "car", "home", "cycling", "outdoors", "travel", "photography", "music", "coffee", "tools", "art", "goals"].contains(&project.icon.as_str()) { return Err("Choose a project icon.".into()); }
        let mut cloud_ids = HashSet::new();
        for link in &project.remarkable_folders {
            if link.id.is_empty() || link.id.len() > 120 || !link.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') || !cloud_ids.insert(&link.id) || link.name.trim().is_empty() || link.name.len() > 1000 {
                return Err("Choose distinct reMarkable folders with valid names.".into());
            }
        }
        let folders: HashSet<_> = project.folders.iter().collect();
        if folders.len() != project.folders.len() || project.folders.iter().any(|p| !allowed.contains(p)) { return Err("Choose folders already added to NotesDive.".into()); }
        if let Some(default) = &project.default_folder {
            if !folders.contains(default) { return Err("The default folder must belong to the project.".into()); }
        }
        let mut sync_ids = HashSet::new();
        let mut sync_paths = HashSet::new();
        for link in &project.remarkable_sync {
            let valid_id = |id: &str| !id.is_empty() && id.len() <= 120 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_');
            if !valid_id(&link.id) || !sync_ids.insert(&link.id) || !valid_id(&link.remote_parent_id)
                || !folders.contains(&link.local_folder)
                || !project.remarkable_folders.iter().any(|parent| parent.id == link.remote_parent_id)
                || !sync_paths.insert((&link.local_folder, &link.path)) {
                return Err("Choose distinct sync folders within this project and a linked reMarkable destination.".into());
            }
            if link.path.len() > 4096 || link.path.contains(['\\', '\0', ':'])
                || (!link.path.is_empty() && link.path.split('/').any(|part| part.is_empty() || part == "." || part == "..")) {
                return Err("Choose a relative sync folder path without traversal.".into());
            }
            if link.enabled && project.remarkable_sync.iter().any(|other| other.enabled && other.id != link.id && other.local_folder == link.local_folder
                && (other.path.is_empty() || link.path.starts_with(&(other.path.clone() + "/")))) {
                return Err("This folder is already included in another sync setup. Turn that setup off first.".into());
            }
        }
    }
    if let Some(active) = &config.active {
        if !config.projects.iter().any(|p| &p.id == active && !p.archived) { return Err("Select an active project.".into()); }
    }
    Ok(())
}
pub(crate) fn store(path: &Path, config: &Projects) -> files::Result<()> {
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid project configuration path")?).map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut temp, config).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
pub(crate) fn project_root(config: &Projects, project_id: &str, folder: &str) -> files::Result<PathBuf> {
    let project = config.projects.iter().find(|p| p.id == project_id && !p.archived).ok_or("Open an active project first.")?;
    if !project.folders.iter().any(|p| p == folder) { return Err("This folder does not belong to the project.".into()); }
    let root = PathBuf::from(folder);
    let canonical = root.canonicalize().map_err(|e| format!("Folder unavailable. Reconnect it in project settings: {e}"))?;
    if root != canonical || !canonical.is_dir() { return Err("Folder location changed. Reconnect it in project settings.".into()); }
    Ok(canonical)
}
#[tauri::command]
pub fn load_projects(app: tauri::AppHandle) -> files::Result<crate::libraries::ProjectContext> { crate::libraries::current(&app) }
#[tauri::command]
pub fn save_projects(app: tauri::AppHandle, state: tauri::State<'_, ProjectState>, config: crate::libraries::ProjectContext) -> files::Result<crate::libraries::ProjectContext> {
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    crate::libraries::save(&app, config)
}
#[tauri::command]
pub async fn choose_project_folder(app: tauri::AppHandle) -> files::Result<Option<Folder>> {
    let picker = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || picker.dialog().file().set_title("Attach a project folder").blocking_pick_folder()).await.map_err(|e| e.to_string())?;
    let Some(path) = selected else { return Ok(None); };
    let root = path.into_path().map_err(|e| e.to_string())?.canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir() { return Err("Choose a folder.".into()); }
    fs::read_dir(&root).map_err(|e| e.to_string())?;
    let folder = Folder { path: root.to_string_lossy().into_owned(), name: root.file_name().unwrap_or(root.as_os_str()).to_string_lossy().into_owned() };
    let mut config = load_workspaces(&app)?.unwrap_or(Workspaces { active: String::new(), folders: vec![] });
    if !config.folders.iter().any(|f| f.path == folder.path) { config.folders.push(folder.clone()); }
    save_workspaces(&app, &config)?;
    Ok(Some(folder))
}
#[tauri::command]
pub async fn list_project_notes(app: tauri::AppHandle, project_id: String, folder: String, query: String, library: Option<String>) -> files::Result<files::Listing> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(&crate::libraries::scoped(&app, library.as_deref())?.config, &project_id, &folder)?;
        files::list(&root, &query)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_project_note(app: tauri::AppHandle, project_id: String, folder: String, path: String, library: Option<String>) -> files::Result<files::Note> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = project_root(&crate::libraries::scoped(&app, library.as_deref())?.config, &project_id, &folder)?;
        files::read(&root, &path)
    }).await.map_err(|e| e.to_string())?
}
pub fn contains_folder(app: &tauri::AppHandle, folder: &str) -> bool {
    crate::libraries::current(app).map(|c| c.config.projects.iter().any(|p| !p.archived && p.folders.iter().any(|f| f == folder))).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn project(folder: String) -> Project {
        Project { id: "one".into(), name: "Research".into(), description: String::new(), color: "sage".into(), pinned: false, archived: false, folders: vec![folder.clone()], default_folder: Some(folder), remarkable_folders: vec![], remarkable_sync: vec![], icon: default_project_icon() }
    }
    #[test]
    fn round_trip_keeps_offline_folders_and_shared_folders() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("projects.json");
        assert!(load(&path).unwrap().projects.is_empty());
        let mut first = project("/offline/notes".into());
        first.icon = "car".into();
        let mut second = first.clone(); second.id = "two".into();
        let config = Projects { active: Some("one".into()), projects: vec![first, second] };
        validate(&config, &HashSet::from(["/offline/notes".into()])).unwrap();
        store(&path, &config).unwrap();
        let restored = load(&path).unwrap();
        assert_eq!(restored.active, config.active);
        assert_eq!(restored.projects.len(), 2);
        assert_eq!(restored.projects[0].icon, "car");
        assert_eq!(restored.projects[0].default_folder.as_deref(), Some("/offline/notes"));
    }
    #[test]
    fn rejects_unknown_roots_invalid_defaults_and_archived_selection() {
        let mut config = Projects { active: Some("one".into()), projects: vec![project("/notes".into())] };
        assert!(validate(&config, &HashSet::new()).is_err());
        let allowed = HashSet::from(["/notes".into()]);
        config.projects[0].default_folder = Some("/elsewhere".into());
        assert!(validate(&config, &allowed).is_err());
        config.projects[0].default_folder = None;
        config.projects[0].archived = true;
        assert!(validate(&config, &allowed).is_err());
    }
    #[test]
    fn project_reads_cannot_escape_attached_roots() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap().to_string_lossy().into_owned();
        let config = Projects { active: None, projects: vec![project(root.clone())] };
        assert!(project_root(&config, "one", &root).is_ok());
        assert!(project_root(&config, "one", "/unattached").is_err());
        assert!(project_root(&config, "missing", &root).is_err());
        assert!(files::read(&project_root(&config, "one", &root).unwrap(), "../outside.md").is_err());
    }
    #[test]
    fn legacy_projects_without_cloud_links_load_and_invalid_links_are_rejected() {
        let value = serde_json::json!({ "id": "p", "name": "Project", "description": "", "color": "sage", "pinned": false, "archived": false, "folders": [], "defaultFolder": null });
        let mut project: Project = serde_json::from_value(value).unwrap();
        assert_eq!(project.icon, "folder");
        assert!(project.remarkable_folders.is_empty());
        project.remarkable_folders.push(RemarkableFolderLink { id: "../invalid".into(), name: "Work".into() });
        assert!(validate(&Projects { active: None, projects: vec![project] }, &HashSet::new()).is_err());
    }
    #[test]
    fn corrupt_metadata_is_not_silently_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("projects.json");
        fs::write(&path, "invalid").unwrap();
        assert!(load(&path).is_err());
    }
    #[test]
    fn sync_setup_rejects_traversal_foreign_targets_and_overlapping_folders() {
        let mut item = project("/notes".into());
        item.remarkable_folders.push(RemarkableFolderLink { id: "cloud".into(), name: "Summa".into() });
        item.remarkable_sync.push(RemarkableSyncFolder { id: "aiim".into(), local_folder: "/notes".into(), path: "AIIM".into(), remote_parent_id: "cloud".into(), enabled: true, state: serde_json::Value::Null });
        let allowed = HashSet::from(["/notes".into()]);
        let check = |item: Project| validate(&Projects { active: None, projects: vec![item] }, &allowed);
        assert!(check(item.clone()).is_ok());
        for path in ["../AIIM", "/AIIM", "AIIM/../Other", "AIIM\\Other", "AIIM//Other", "C:/AIIM"] {
            let mut invalid = item.clone(); invalid.remarkable_sync[0].path = path.into();
            assert!(check(invalid).is_err(), "accepted {path}");
        }
        let mut invalid = item.clone(); invalid.remarkable_sync[0].remote_parent_id = "foreign".into();
        assert!(check(invalid).is_err());
        let mut invalid = item.clone(); invalid.remarkable_sync[0].local_folder = "/other".into();
        assert!(check(invalid).is_err());
        let mut nested = item.clone();
        let mut child = item.remarkable_sync[0].clone(); child.id = "child".into(); child.path = "AIIM/Meeting".into();
        nested.remarkable_sync.push(child);
        assert!(check(nested.clone()).is_err());
        nested.remarkable_sync[1].enabled = false;
        assert!(check(nested).is_ok());
    }
}
