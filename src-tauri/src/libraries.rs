use crate::{files::Result, projects::{self, Project, Projects}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashSet}, fs, path::{Component, Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectContext {
    #[serde(flatten)] pub config: Projects,
    #[serde(default)] pub library: Option<String>,
    #[serde(default)] pub revision: String,
    #[serde(default, skip_serializing)] pub reconnections: Vec<Reconnection>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconnection { pub project_id: String, pub from: String, pub to: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest { format_version: u32, id: String, name: String }
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum FolderRef { Relative { path: String }, External { id: String, name: String } }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFile {
    #[serde(skip)]
    directory: String,
    #[serde(default = "projects::default_project_icon")]
    icon: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    remarkable_folders: Vec<crate::projects::RemarkableFolderLink>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    remarkable_sync: Vec<SyncFolderFile>,
    format_version: u32, id: String, name: String, description: String,
    color: String, pinned: bool, archived: bool, folders: Vec<FolderRef>, default_folder: Option<FolderRef>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncFolderFile {
    id: String, local_folder: FolderRef, path: String, remote_parent_id: String, enabled: bool,
    #[serde(default)] state: serde_json::Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub path: String, pub name: String, pub id: String,
    #[serde(default)] pub active_project: Option<String>,
    #[serde(default)] bindings: BTreeMap<String, String>,
}
#[derive(Default, Serialize, Deserialize)]
pub struct Registry { pub active: Option<String>, pub libraries: Vec<Library> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListing { active: Option<String>, libraries: Vec<LibrarySummary>, legacy_projects: usize, legacy_error: Option<String> }
#[derive(Serialize)]
struct LibrarySummary { path: String, name: String, available: bool }
#[derive(Serialize)]
pub struct ThemeListing { path: String, exists: bool, themes: Vec<String> }

fn themes_at(root: &Path, create: bool) -> Result<ThemeListing> {
    let directory = relative_path(root, "themes")?;
    if create { fs::create_dir_all(&directory).map_err(|e| e.to_string())?; }
    let mut themes = vec![];
    if directory.exists() {
        for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
            let path = entry.path();
            if !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("css")) { continue; }
            if let Some(name) = path.file_stem().and_then(|stem| stem.to_str()).filter(|name| valid_id(name)) { themes.push(name.to_string()); }
        }
    }
    themes.sort();
    Ok(ThemeListing { path: directory.to_string_lossy().into_owned(), exists: directory.is_dir(), themes })
}

fn theme_library_root(app: &tauri::AppHandle, requested: &str) -> Result<PathBuf> {
    let registry = registry(app)?;
    if registry.active.as_deref() != Some(requested) { return Err("The library changed. Reload before opening its themes.".into()); }
    let library = registry.libraries.iter().find(|entry| entry.path == requested).ok_or("Unknown library")?;
    let root = root(requested)?;
    if manifest(&root)?.0.id != library.id { return Err("A different library is at this location. Open it explicitly first.".into()); }
    Ok(root)
}

#[tauri::command]
pub fn library_themes(app: tauri::AppHandle, state: State<'_, projects::ProjectState>, library: String, create: bool) -> Result<ThemeListing> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    themes_at(&theme_library_root(&app, &library)?, create)
}

#[tauri::command]
pub fn read_library_marp_theme(app: tauri::AppHandle, state: State<'_, projects::ProjectState>, library: String, name: String) -> Result<String> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    if !valid_id(&name) { return Err("Use a theme name with letters, numbers, dashes or underscores.".into()); }
    let root = theme_library_root(&app, &library)?;
    let relative = format!("themes/{name}.css");
    relative_path(&root, &relative)?;
    crate::files::read_marp_theme(&root, &relative)
}

fn theme_image_at(root: &Path, path: &str) -> Result<crate::files::Asset> {
    let relative = Path::new(path);
    if !relative.starts_with("themes") || !relative.extension().is_some_and(|ext|
        ["png", "jpg", "jpeg", "svg"].iter().any(|image| ext.eq_ignore_ascii_case(image))) {
        return Err("Choose a local image inside the library's themes folder.".into());
    }
    relative_path(root, path)?;
    crate::files::read_asset(root, path)
}

#[tauri::command]
pub fn read_library_marp_image(app: tauri::AppHandle, state: State<'_, projects::ProjectState>, library: String, path: String) -> Result<crate::files::Asset> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    theme_image_at(&theme_library_root(&app, &library)?, &path)
}

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn registry_path(app: &tauri::AppHandle) -> Result<PathBuf> { Ok(app_dir(app)?.join("libraries.json")) }
fn registry(app: &tauri::AppHandle) -> Result<Registry> { read_registry(&registry_path(app)?) }
fn read_registry(path: &Path) -> Result<Registry> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Could not read library locations: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Registry::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let mut temp = tempfile::Builder::new().prefix(".notesdive-tmp-").tempfile_in(path.parent().ok_or("Missing parent folder")?).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut temp, value).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn digest(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() <= 120 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') }
fn root(path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    let canonical = path.canonicalize().map_err(|e| format!("Library unavailable. Open it again at its current location: {e}"))?;
    if path != canonical || !canonical.is_dir() { return Err("The library location changed. Open the library again.".into()); }
    Ok(canonical)
}
// Portable metadata cannot grant access outside the explicitly opened library.
fn relative_path(root: &Path, path: &str) -> Result<PathBuf> {
    if path.is_empty() || path.contains('\\') || path.contains(':') || Path::new(path).components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("Library contains an unsafe relative path.".into());
    }
    let mut next = root.to_path_buf();
    for part in Path::new(path).components() {
        next.push(part);
        match fs::symlink_metadata(&next) {
            Ok(meta) if meta.file_type().is_symlink() => return Err("Library paths cannot follow symbolic links.".into()),
            Ok(_) => {},
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {},
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(next)
}
fn manifest(root: &Path) -> Result<(Manifest, Vec<u8>)> {
    let bytes = fs::read(relative_path(root, "library.json")?).map_err(|e| format!("Choose a NotesDive library folder containing library.json: {e}"))?;
    let value: Manifest = serde_json::from_slice(&bytes).map_err(|e| format!("Invalid library.json: {e}"))?;
    if value.format_version != 1 || !valid_id(&value.id) || value.name.trim().is_empty() { return Err("Unsupported or invalid NotesDive library format.".into()); }
    Ok((value, bytes))
}
fn placeholder(id: &str, name: &str) -> String { format!("notesdive-external:{id}/{name}") }
fn resolve(reference: &FolderRef, root: &Path, library: &Library) -> Result<String> {
    match reference {
        FolderRef::Relative { path } => Ok(relative_path(root, path)?.to_string_lossy().into_owned()),
        FolderRef::External { id, name } => {
            if !valid_id(id) { return Err("Invalid external folder reference.".into()); }
            Ok(library.bindings.get(id).cloned().unwrap_or_else(|| placeholder(id, name)))
        }
    }
}
fn ensure_project_notes(home: &Path, name: &str) -> Result<()> {
    // Migrate once: a document intentionally trashed later must stay deleted.
    let marker = home.join(".notesdive-project-notes-v1");
    if marker.exists() { return Ok(()); }
    let entries = fs::read_dir(home).map_err(|e| e.to_string())?.collect::<std::io::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    let old_links = entries.iter().find(|entry| entry.file_name() == "Links.md");
    let has_links = entries.iter().any(|entry| entry.file_name() == "links.md");
    if let Some(old) = old_links {
        if !has_links && old.file_type().map_err(|e| e.to_string())?.is_file() {
            // A temporary name also handles case-insensitive macOS volumes.
            let temporary = tempfile::Builder::new().prefix(".notesdive-tmp-").tempfile_in(home).map_err(|e| e.to_string())?;
            fs::rename(old.path(), temporary.path()).map_err(|e| e.to_string())?;
            fs::rename(temporary.path(), home.join("links.md")).map_err(|e| e.to_string())?;
        }
    }
    use std::io::Write;
    match fs::OpenOptions::new().write(true).create_new(true).open(home.join("todo.md")) {
        Ok(mut file) => file.write_all(format!("# {name} - todo\n\n").as_bytes()).map_err(|e| e.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {},
        Err(error) => return Err(error.to_string()),
    }
    fs::write(marker, "").map_err(|e| e.to_string())?;
    Ok(())
}
fn read_library(library: &Library) -> Result<(ProjectContext, BTreeMap<String, ProjectFile>)> {
    let root = root(&library.path)?;
    let (manifest, bytes) = manifest(&root)?;
    if manifest.id != library.id { return Err("A different library is at this location. Open it explicitly before continuing.".into()); }
    let mut hasher = Sha256::new(); hasher.update(bytes);
    hasher.update(serde_json::to_vec(&library.bindings).map_err(|e| e.to_string())?);
    let project_dir = relative_path(&root, "projects")?;
    let mut dirs = fs::read_dir(&project_dir).map_err(|e| format!("Could not read library projects: {e}"))?.collect::<std::io::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    dirs.sort_by_key(|e| e.file_name());
    let mut projects = vec![];
    let mut records = BTreeMap::new();
    for entry in dirs {
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') { continue; }
        if entry.file_type().map_err(|e| e.to_string())?.is_symlink() { return Err("Project folders cannot be symbolic links.".into()); }
        if !entry.path().is_dir() { continue; }
        if !valid_id(&id) { return Err(format!("Invalid project folder: {id}")); }
        let path = relative_path(&root, &format!("projects/{id}/project.json"))?;
        let bytes = fs::read(path).map_err(|e| format!("Could not read project {id}: {e}"))?;
        let mut record: ProjectFile = serde_json::from_slice(&bytes).map_err(|e| format!("Invalid project {id}: {e}"))?;
        if record.format_version != 1 || !valid_id(&record.id) || records.contains_key(&record.id) { return Err(format!("Unsupported or mismatched project: {id}")); }
        record.directory = id.clone();
        hasher.update(id.as_bytes()); hasher.update(bytes);
        let project = Project {
            icon: record.icon.clone(),
            remarkable_folders: record.remarkable_folders.clone(),
            remarkable_sync: record.remarkable_sync.iter().map(|link| Ok(crate::projects::RemarkableSyncFolder {
                id: link.id.clone(), local_folder: resolve(&link.local_folder, &root, library)?,
                path: link.path.clone(), remote_parent_id: link.remote_parent_id.clone(), enabled: link.enabled, state: link.state.clone(),
            })).collect::<Result<Vec<_>>>()?,
            id: record.id.clone(), name: record.name.clone(), description: record.description.clone(), color: record.color.clone(), pinned: record.pinned, archived: record.archived,
            folders: record.folders.iter().map(|f| resolve(f, &root, library)).collect::<Result<Vec<_>>>()?,
            default_folder: record.default_folder.as_ref().map(|f| resolve(f, &root, library)).transpose()?,
        };
        projects.push(project); records.insert(record.id.clone(), record);
    }
    let active = library.active_project.clone().filter(|id| projects.iter().any(|p| &p.id == id && !p.archived));
    let config = Projects { active, projects };
    let allowed = config.projects.iter().flat_map(|p| p.folders.clone()).collect();
    projects::validate(&config, &allowed)?;
    for record in records.values() {
        ensure_project_notes(&relative_path(&root, &format!("projects/{}", record.directory))?, &record.name)?;
    }
    Ok((ProjectContext { config, library: Some(library.path.clone()), revision: format!("{:x}", hasher.finalize()), reconnections: vec![] }, records))
}
fn legacy_context(app: &tauri::AppHandle) -> Result<ProjectContext> {
    let path = projects::config_path(app)?;
    let config = projects::load(&path)?;
    let bytes = if path.exists() { fs::read(&path).map_err(|e| e.to_string())? } else { vec![] };
    Ok(ProjectContext { config, library: None, revision: digest(&bytes), reconnections: vec![] })
}
pub fn current(app: &tauri::AppHandle) -> Result<ProjectContext> {
    let registry = registry(app)?;
    match &registry.active {
        None => legacy_context(app),
        Some(path) => read_library(registry.libraries.iter().find(|l| &l.path == path).ok_or("Unknown library location")?).map(|v| v.0),
    }
}
pub fn scoped(app: &tauri::AppHandle, requested: Option<&str>) -> Result<ProjectContext> {
    let context = current(app)?;
    if context.library.as_deref() != requested { return Err("The library changed. Return to Projects and try again.".into()); }
    Ok(context)
}
fn folder_reference(path: &str, root: &Path, library: &mut Library, previous: Option<&ProjectFile>, project_id: &str) -> Result<FolderRef> {
    if let Some(record) = previous {
        for reference in &record.folders {
            if resolve(reference, root, library)? == path { return Ok(reference.clone()); }
        }
    }
    if path.starts_with("notesdive-external:") { return Err("Reconnect the external folder first.".into()); }
    let absolute = PathBuf::from(path);
    if let Ok(relative) = absolute.strip_prefix(root) {
        let relative = relative.to_string_lossy().replace('\\', "/");
        relative_path(root, &relative)?;
        return Ok(FolderRef::Relative { path: relative });
    }
    if !absolute.is_absolute() { return Err("External folders must be explicitly selected on this computer.".into()); }
    let id = digest(format!("{project_id}\n{path}").as_bytes());
    library.bindings.insert(id.clone(), path.to_string());
    Ok(FolderRef::External { id, name: absolute.file_name().unwrap_or(absolute.as_os_str()).to_string_lossy().into_owned() })
}
fn project_directory_name(name: &str) -> String {
    let mut slug = String::new();
    for character in name.chars() {
        if character.is_ascii_alphanumeric() { slug.push(character.to_ascii_lowercase()); }
        else if !slug.is_empty() && !slug.ends_with('-') { slug.push('-'); }
        if slug.len() >= 80 { break; }
    }
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() { "project".into() } else { slug.into() }
}
fn write_library(library: &mut Library, incoming: &ProjectContext, allowed: &HashSet<String>) -> Result<ProjectContext> {
    let (previous, records) = read_library(library)?;
    if incoming.library.as_deref() != Some(&library.path) || incoming.revision != previous.revision { return Err("Project metadata changed on disk. Reload the library before saving; your files have not been overwritten.".into()); }
    if previous.config.projects.iter().any(|old| !incoming.config.projects.iter().any(|p| p.id == old.id)) { return Err("Archive projects instead of removing their files.".into()); }
    projects::validate(&incoming.config, allowed)?;
    let root = root(&library.path)?;
    let mut config = incoming.config.clone();
    let mut directories: BTreeMap<String, String> = records.iter().map(|(id, record)| (id.clone(), record.directory.clone())).collect();
    for project in &mut config.projects {
        if !valid_id(&project.id) { return Err("Invalid project ID.".into()); }
        if !records.contains_key(&project.id) {
            let base = project_directory_name(&project.name);
            let mut directory = base.clone();
            let mut suffix = 2;
            while root.join("projects").join(&directory).exists() || directories.values().any(|value| value.eq_ignore_ascii_case(&directory)) {
                directory = format!("{base}-{suffix}"); suffix += 1;
            }
            let home = relative_path(&root, &format!("projects/{directory}"))?;
            directories.insert(project.id.clone(), directory);
            if home.exists() { return Err("The new project folder already exists.".into()); }
            let home = home.to_string_lossy().into_owned();
            if !project.folders.contains(&home) { project.folders.insert(0, home.clone()); }
            if project.default_folder.is_none() { project.default_folder = Some(home); }
        }
    }
    // Reconnecting on one computer changes only its local binding, not the portable reference ID.
    for link in &incoming.reconnections {
        let project = config.projects.iter().find(|p| p.id == link.project_id).ok_or("Unknown project to reconnect")?;
        if !project.folders.contains(&link.to) || !allowed.contains(&link.to) { return Err("Choose an authorized replacement folder.".into()); }
        let old = records.get(&link.project_id).ok_or("Unknown project to reconnect")?;
        for reference in &old.folders {
            if resolve(reference, &root, library)? == link.from {
                if let FolderRef::External { id, .. } = reference {
                    if !Path::new(&link.to).starts_with(&root) { library.bindings.insert(id.clone(), link.to.clone()); }
                }
                break;
            }
        }
    }
    // Resolve every record before writing any file, so invalid input cannot partially update metadata.
    let mut pending = vec![];
    for project in &config.projects {
        let previous = records.get(&project.id);
        let folders = project.folders.iter().map(|p| folder_reference(p, &root, library, previous, &project.id)).collect::<Result<Vec<_>>>()?;
        let default_folder = project.default_folder.as_ref().map(|path| project.folders.iter().position(|p| p == path).map(|i| folders[i].clone()).ok_or("Invalid default folder")).transpose()?;
        let remarkable_sync = project.remarkable_sync.iter().map(|link| {
            let index = project.folders.iter().position(|folder| folder == &link.local_folder).ok_or("Sync folder must belong to the project.")?;
            Ok(SyncFolderFile { id: link.id.clone(), local_folder: folders[index].clone(), path: link.path.clone(),
                remote_parent_id: link.remote_parent_id.clone(), enabled: link.enabled, state: link.state.clone() })
        }).collect::<Result<Vec<_>>>()?;
        let record = ProjectFile { directory: directories[&project.id].clone(), icon: project.icon.clone(), remarkable_folders: project.remarkable_folders.clone(), remarkable_sync, format_version: 1, id: project.id.clone(), name: project.name.clone(), description: project.description.clone(), color: project.color.clone(), pinned: project.pinned, archived: project.archived, folders, default_folder };
        pending.push(record);
    }
    for record in pending {
        let home = relative_path(&root, &format!("projects/{}", record.directory))?;
        if let Some(old) = records.get(&record.id) {
            if serde_json::to_vec(old).map_err(|e| e.to_string())? != serde_json::to_vec(&record).map_err(|e| e.to_string())? { write_json(&home.join("project.json"), &record)?; }
        } else {
            let staged = tempfile::Builder::new().prefix(".notesdive-tmp-").tempdir_in(root.join("projects")).map_err(|e| e.to_string())?;
            fs::create_dir(staged.path().join("notes")).map_err(|e| e.to_string())?;
            fs::create_dir(staged.path().join("attachments")).map_err(|e| e.to_string())?;
            // Git retains the destinations even before the first note or attachment is added.
            fs::write(staged.path().join("notes/.gitkeep"), "").map_err(|e| e.to_string())?;
            fs::write(staged.path().join("attachments/.gitkeep"), "").map_err(|e| e.to_string())?;
            fs::write(staged.path().join("README.md"), format!("# {}\n\n{}\n", record.name, record.description)).map_err(|e| e.to_string())?;
            fs::write(staged.path().join("todo.md"), format!("# {} - todo\n\n", record.name)).map_err(|e| e.to_string())?;
            fs::write(staged.path().join("links.md"), format!("# {} - links\n\n", record.name)).map_err(|e| e.to_string())?;
            write_json(&staged.path().join("project.json"), &record)?;
            fs::rename(staged.path(), &home).map_err(|e| e.to_string())?;
        }
    }
    library.active_project = config.active;
    read_library(library).map(|v| v.0)
}
pub fn save(app: &tauri::AppHandle, incoming: ProjectContext) -> Result<ProjectContext> {
    let previous = scoped(app, incoming.library.as_deref())?;
    if previous.revision != incoming.revision { return Err("Project metadata changed on disk. Reload Projects before saving.".into()); }
    let mut allowed: HashSet<String> = previous.config.projects.iter().flat_map(|p| p.folders.clone()).collect();
    allowed.extend(crate::load_workspaces(app)?.map(|c| c.folders.into_iter().map(|f| f.path).collect::<Vec<_>>()).unwrap_or_default());
    if incoming.library.is_none() {
        projects::validate(&incoming.config, &allowed)?;
        projects::store(&projects::config_path(app)?, &incoming.config)?;
        return legacy_context(app);
    }
    let mut registry = registry(app)?;
    let selected = registry.libraries.iter_mut().find(|l| Some(&l.path) == incoming.library.as_ref()).ok_or("Unknown library")?;
    let result = write_library(selected, &incoming, &allowed);
    // Persist bindings even after an interrupted multi-project import; originals remain in legacy storage.
    write_json(&registry_path(app)?, &registry)?;
    result
}
fn register(registry: &mut Registry, path: PathBuf) -> Result<()> {
    let (manifest, _) = manifest(&path)?;
    let path = path.to_string_lossy().into_owned();
    let mut entry = registry.libraries.iter().find(|l| l.id == manifest.id).cloned().unwrap_or(Library { path: path.clone(), name: manifest.name.clone(), id: manifest.id.clone(), active_project: None, bindings: BTreeMap::new() });
    entry.path = path.clone(); entry.name = manifest.name;
    read_library(&entry)?;
    registry.libraries.retain(|l| l.id != entry.id && l.path != path);
    registry.libraries.push(entry); registry.active = Some(path);
    Ok(())
}
fn create_at(parent: &Path, name: &str) -> Result<PathBuf> {
    if name.trim().is_empty() || name != name.trim() || name.chars().count() > 80 || name.contains(['/', '\\', ':']) || name == "." || name == ".." { return Err("Choose a library name without path separators (up to 80 characters).".into()); }
    let destination = parent.join(name);
    if destination.exists() { return Err("That folder already exists. Choose a different name, or open it as an existing library.".into()); }
    let staged = tempfile::Builder::new().prefix(".notesdive-tmp-").tempdir_in(parent).map_err(|e| e.to_string())?;
    fs::create_dir(staged.path().join("projects")).map_err(|e| e.to_string())?;
    fs::create_dir(staged.path().join("themes")).map_err(|e| e.to_string())?;
    let id = digest(format!("{}:{:?}", destination.display(), SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?).as_bytes());
    write_json(&staged.path().join("library.json"), &Manifest { format_version: 1, id, name: name.to_string() })?;
    fs::write(staged.path().join(".gitignore"), ".DS_Store\n.notesdive-tmp-*\n").map_err(|e| e.to_string())?;
    fs::write(staged.path().join("README.md"), format!("# {name}\n\nA NotesDive library. Open this folder in NotesDive to restore its projects.\nProject metadata and files live in projects/. External folder connections are configured separately on each computer.\nGit is optional; this folder can be part of a repository.\n")).map_err(|e| e.to_string())?;
    fs::rename(staged.path(), &destination).map_err(|e| e.to_string())?;
    destination.canonicalize().map_err(|e| e.to_string())
}
async fn pick(app: &tauri::AppHandle, title: &'static str) -> Result<Option<PathBuf>> {
    let picker = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || picker.dialog().file().set_title(title).blocking_pick_folder()).await.map_err(|e| e.to_string())?;
    selected.map(|p| p.into_path().map_err(|e| e.to_string()).and_then(|p| p.canonicalize().map_err(|e| e.to_string()))).transpose()
}
#[tauri::command]
pub fn list_libraries(app: tauri::AppHandle) -> Result<LibraryListing> {
    let registry = registry(&app)?;
    let (legacy_projects, legacy_error) = match projects::load(&projects::config_path(&app)?) {
        Ok(config) => (config.projects.len(), None),
        Err(error) => (0, Some(error)),
    };
    Ok(LibraryListing { active: registry.active, libraries: registry.libraries.into_iter().map(|l| LibrarySummary { available: Path::new(&l.path).join("library.json").is_file(), path: l.path, name: l.name }).collect(), legacy_projects, legacy_error })
}
#[tauri::command]
pub async fn choose_library(app: tauri::AppHandle, name: Option<String>) -> Result<bool> {
    let selected = pick(&app, if name.is_some() { "Choose where to create the new library folder" } else { "Open a NotesDive library folder" }).await?;
    let Some(parent) = selected else { return Ok(false); };
    let state = app.state::<projects::ProjectState>();
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    let path = if let Some(name) = name { create_at(&parent, &name)? } else { parent };
    let mut registry = registry(&app)?;
    register(&mut registry, path)?;
    write_json(&registry_path(&app)?, &registry)?;
    Ok(true)
}
#[tauri::command]
pub fn switch_library(app: tauri::AppHandle, state: State<'_, projects::ProjectState>, path: Option<String>) -> Result<()> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    let mut registry = registry(&app)?;
    if let Some(path) = &path { read_library(registry.libraries.iter().find(|l| &l.path == path).ok_or("Open this library with the folder picker first.")?)?; }
    registry.active = path;
    write_json(&registry_path(&app)?, &registry)
}
#[tauri::command]
pub fn forget_library(app: tauri::AppHandle, state: State<'_, projects::ProjectState>, path: String) -> Result<()> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    let mut registry = registry(&app)?;
    registry.libraries.retain(|l| l.path != path);
    if registry.active.as_ref() == Some(&path) { registry.active = None; }
    write_json(&registry_path(&app)?, &registry)
}
#[tauri::command]
pub fn import_legacy_projects(app: tauri::AppHandle, state: State<'_, projects::ProjectState>) -> Result<ProjectContext> {
    let _lock = state.0.lock().map_err(|e| e.to_string())?;
    let mut context = current(&app)?;
    if context.library.is_none() { return Err("Create or open a library first.".into()); }
    let legacy = projects::load(&projects::config_path(&app)?)?;
    let mut registry = registry(&app)?;
    let library = registry.libraries.iter_mut().find(|l| Some(&l.path) == context.library.as_ref()).ok_or("Unknown library")?;
    let mut allowed: HashSet<String> = context.config.projects.iter().flat_map(|p| p.folders.clone()).collect();
    for project in legacy.projects {
        if !context.config.projects.iter().any(|p| p.id == project.id) {
            allowed.extend(project.folders.clone()); context.config.projects.push(project);
        }
    }
    let result = write_library(library, &context, &allowed);
    write_json(&registry_path(&app)?, &registry)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup(parent: &Path, name: &str) -> Library {
        let path = create_at(parent, name).unwrap();
        let mut registry = Registry::default();
        register(&mut registry, path).unwrap();
        registry.libraries.remove(0)
    }
    #[test]
    fn library_theme_folder_is_portable_and_listing_does_not_change_files() {
        let dir = tempfile::tempdir().unwrap(); let parent = dir.path().canonicalize().unwrap();
        let library = setup(&parent, "Work");
        let root = PathBuf::from(&library.path);
        assert!(root.join("themes").is_dir());
        fs::write(root.join("themes/workshop.css"), "/* @theme workshop */").unwrap();
        fs::write(root.join("themes/readme.txt"), "Keep this file").unwrap();
        assert_eq!(themes_at(&root, false).unwrap().themes, vec!["workshop"]);
        let moved = parent.join("Moved"); fs::rename(root, &moved).unwrap();
        assert_eq!(themes_at(&moved, false).unwrap().themes, vec!["workshop"]);
        assert_eq!(fs::read_to_string(moved.join("themes/readme.txt")).unwrap(), "Keep this file");
        fs::remove_file(moved.join("themes/workshop.css")).unwrap();
        fs::remove_file(moved.join("themes/readme.txt")).unwrap();
        fs::remove_dir(moved.join("themes")).unwrap();
        assert!(!themes_at(&moved, false).unwrap().exists);
        assert!(themes_at(&moved, true).unwrap().exists);
    }
    #[cfg(unix)]
    #[test]
    fn library_themes_do_not_follow_symbolic_links() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("themes")).unwrap();
        assert!(themes_at(&root, false).is_err());
        assert!(themes_at(&root, true).is_err());
    }
    #[test]
    fn library_theme_images_stay_in_the_themes_directory() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        fs::create_dir_all(root.join("themes/demo")).unwrap();
        fs::write(root.join("themes/demo/logo.svg"), "<svg/>").unwrap();
        fs::write(root.join("secret.svg"), "<svg/>").unwrap();
        fs::write(root.join("themes/demo/index.html"), "<script/>").unwrap();
        assert_eq!(theme_image_at(&root, "themes/demo/logo.svg").unwrap().mime, "image/svg+xml");
        assert!(theme_image_at(&root, "secret.svg").is_err());
        assert!(theme_image_at(&root, "themes/../secret.svg").is_err());
        assert!(theme_image_at(&root, "themes/demo/index.html").is_err());
        assert!(theme_image_at(&root, "/themes/demo/logo.svg").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn library_theme_images_reject_symlinks_and_external_directories() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().canonicalize().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(root.join("themes")).unwrap();
        fs::write(outside.path().join("logo.svg"), "<svg/>").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("themes/external")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("logo.svg"), root.join("themes/logo.svg")).unwrap();
        assert!(theme_image_at(&root, "themes/external/logo.svg").is_err());
        assert!(theme_image_at(&root, "themes/logo.svg").is_err());
    }
    fn new_project(context: &mut ProjectContext, id: &str) {
        context.config.projects.push(Project { id: id.into(), name: "Research".into(), description: "Portable notes".into(), color: "blue".into(), pinned: false, archived: false, folders: vec![], default_folder: None, remarkable_folders: vec![], remarkable_sync: vec![], icon: projects::default_project_icon() });
        context.config.active = Some(id.into());
    }
    #[test]
    fn readable_project_directories_keep_ids_and_disambiguate_names() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let mut library = setup(&parent, "Work");
        let mut incoming = read_library(&library).unwrap().0;
        new_project(&mut incoming, "id-one");
        new_project(&mut incoming, "id-two");
        let mut saved = write_library(&mut library, &incoming, &HashSet::new()).unwrap();
        let root = PathBuf::from(&library.path);
        assert!(root.join("projects/research/project.json").is_file());
        assert!(root.join("projects/research-2/project.json").is_file());
        assert_eq!(saved.config.projects[0].id, "id-one");
        saved.config.projects[0].name = "New display name".into();
        let allowed = saved.config.projects.iter().flat_map(|p| p.folders.clone()).collect();
        write_library(&mut library, &saved, &allowed).unwrap();
        assert!(root.join("projects/research/project.json").is_file());
        // Existing GUID directories also remain readable until explicitly migrated.
        fs::rename(root.join("projects/research"), root.join("projects/id-one")).unwrap();
        assert_eq!(read_library(&library).unwrap().0.config.projects.len(), 2);
    }
    #[test]
    fn existing_project_notes_are_migrated_without_losing_content() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("Links.md"), "# My links\n\nKeep this link").unwrap();
        ensure_project_notes(dir.path(), "Research").unwrap();
        assert!(fs::read_dir(dir.path()).unwrap().all(|entry| entry.unwrap().file_name() != "Links.md"));
        assert_eq!(fs::read_to_string(dir.path().join("links.md")).unwrap(), "# My links\n\nKeep this link");
        assert_eq!(fs::read_to_string(dir.path().join("todo.md")).unwrap(), "# Research - todo\n\n");
        fs::write(dir.path().join("todo.md"), "- [ ] Keep task").unwrap();
        ensure_project_notes(dir.path(), "Renamed").unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("todo.md")).unwrap(), "- [ ] Keep task");
        fs::remove_file(dir.path().join("todo.md")).unwrap();
        ensure_project_notes(dir.path(), "Research").unwrap();
        assert!(!dir.path().join("todo.md").exists());
    }
    #[test]
    fn creates_portable_project_files_and_reopens_after_move_without_app_config() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let mut library = setup(&parent, "Work");
        let mut incoming = read_library(&library).unwrap().0;
        new_project(&mut incoming, "research-1");
        incoming.config.projects[0].icon = "education".into();
        incoming.config.projects[0].color = "violet".into();
        let saved = write_library(&mut library, &incoming, &HashSet::new()).unwrap();
        let home = PathBuf::from(&library.path).join("projects/research");
        for path in ["README.md", "todo.md", "links.md", "project.json", "notes/.gitkeep", "attachments/.gitkeep"] { assert!(home.join(path).exists()); }
        assert_eq!(fs::read_to_string(home.join("links.md")).unwrap(), "# Research - links\n\n");
        assert_eq!(fs::read_to_string(home.join("todo.md")).unwrap(), "# Research - todo\n\n");
        fs::write(home.join("todo.md"), "# Research - todo\n\n- [ ] Keep my task\n").unwrap();
        write_library(&mut library, &saved, &saved.config.projects[0].folders.iter().cloned().collect()).unwrap();
        assert_eq!(fs::read_to_string(home.join("todo.md")).unwrap(), "# Research - todo\n\n- [ ] Keep my task\n");
        let metadata = fs::read_to_string(home.join("project.json")).unwrap();
        assert!(!metadata.contains(&library.path));
        assert!(metadata.contains("projects/research"));
        assert_eq!(saved.config.projects[0].default_folder.as_ref(), Some(&home.to_string_lossy().into_owned()));
        fs::write(home.join("notes/thought.md"), "# Keep this thought").unwrap();
        let moved = parent.join("Moved");
        fs::rename(&library.path, &moved).unwrap();
        let mut clean_registry = Registry::default();
        register(&mut clean_registry, moved.clone()).unwrap();
        let reopened = read_library(&clean_registry.libraries[0]).unwrap().0;
        assert_eq!(reopened.config.projects[0].icon, "education");
        assert_eq!(reopened.config.projects[0].color, "violet");
        assert_eq!(reopened.config.projects[0].folders[0], moved.join("projects/research").to_string_lossy());
        assert_eq!(fs::read_to_string(moved.join("projects/research/notes/thought.md")).unwrap(), "# Keep this thought");
    }
    #[test]
    fn external_paths_stay_local_and_can_be_reconnected_on_another_computer() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let external = parent.join("PrivateNotes"); fs::create_dir(&external).unwrap();
        let external = external.to_string_lossy().into_owned();
        let mut library = setup(&parent, "Work");
        let mut incoming = read_library(&library).unwrap().0;
        new_project(&mut incoming, "one");
        incoming.config.projects[0].folders.push(external.clone());
        incoming.config.projects[0].default_folder = Some(external.clone());
        write_library(&mut library, &incoming, &HashSet::from([external.clone()])).unwrap();
        let raw = fs::read_to_string(Path::new(&library.path).join("projects/research/project.json")).unwrap();
        assert!(!raw.contains(&external)); assert!(raw.contains("external"));
        let mut elsewhere = library.clone(); elsewhere.bindings.clear();
        let mut reopened = read_library(&elsewhere).unwrap().0;
        assert!(reopened.config.projects[0].folders[1].starts_with("notesdive-external:"));
        let other = parent.join("NewExternal"); fs::create_dir(&other).unwrap();
        let other = other.to_string_lossy().into_owned();
        let mut allowed: HashSet<String> = reopened.config.projects[0].folders.clone().into_iter().collect(); allowed.insert(other.clone());
        let missing = reopened.config.projects[0].folders[1].clone();
        reopened.reconnections.push(Reconnection { project_id: "one".into(), from: missing, to: other.clone() });
        reopened.config.projects[0].folders[1] = other.clone();
        reopened.config.projects[0].default_folder = Some(other.clone());
        let saved = write_library(&mut elsewhere, &reopened, &allowed).unwrap();
        assert_eq!(saved.config.projects[0].default_folder.as_ref(), Some(&other));
        assert_eq!(read_library(&library).unwrap().0.config.projects[0].folders[1], external);
    }
    #[test]
    fn sync_setup_is_portable_and_preserved_on_unrelated_project_edits() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let mut library = setup(&parent, "Work");
        let mut incoming = read_library(&library).unwrap().0;
        new_project(&mut incoming, "summa");
        let mut incoming = write_library(&mut library, &incoming, &HashSet::new()).unwrap();
        let project = &mut incoming.config.projects[0];
        let local = project.folders[0].clone();
        project.remarkable_folders.push(crate::projects::RemarkableFolderLink { id: "destination".into(), name: "3.1 Summa".into() });
        project.remarkable_sync.push(crate::projects::RemarkableSyncFolder { id: "aiim".into(), local_folder: local.clone(), path: "notes/AIIM".into(), remote_parent_id: "destination".into(), enabled: true, state: serde_json::Value::Null });
        let journal = serde_json::json!({"folders":{"notes/AIIM":"a-folder"},"files":[{"path":"notes/AIIM/test.md","documentId":"a-doc","pageId":"a-page","localHash":"local","remoteHash":"remote"}],"lastSync":123});
        project.remarkable_sync[0].state = journal.clone();
        let mut saved = write_library(&mut library, &incoming, &HashSet::from([local])).unwrap();
        saved.config.projects[0].description = "Updated description".into();
        write_library(&mut library, &saved, &saved.config.projects[0].folders.iter().cloned().collect()).unwrap();
        let raw = fs::read_to_string(Path::new(&library.path).join("projects/research/project.json")).unwrap();
        assert!(!raw.contains(&library.path));
        let json: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(json["remarkableSync"][0]["localFolder"]["kind"], "relative");
        let moved = parent.join("Moved"); fs::rename(&library.path, &moved).unwrap();
        let mut clean = Registry::default(); register(&mut clean, moved.clone()).unwrap();
        let reopened = read_library(&clean.libraries[0]).unwrap().0;
        let link = &reopened.config.projects[0].remarkable_sync[0];
        assert_eq!(link.local_folder, moved.join("projects/research").to_string_lossy());
        assert_eq!(link.path, "notes/AIIM"); assert_eq!(link.remote_parent_id, "destination"); assert!(link.enabled);
        assert_eq!(link.state, journal);
    }
    #[test]
    fn cloud_folder_links_survive_save_reopen_and_library_move() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let mut library = setup(&parent, "Cloud work");
        let mut context = read_library(&library).unwrap().0;
        new_project(&mut context, "one");
        context.config.projects[0].remarkable_folders.push(crate::projects::RemarkableFolderLink { id: "cloud-folder-id".into(), name: "Work".into() });
        write_library(&mut library, &context, &HashSet::new()).unwrap();
        let restored = read_library(&library).unwrap().0;
        assert_eq!(restored.config.projects[0].remarkable_folders[0].id, "cloud-folder-id");
        let moved = parent.join("Moved cloud work");
        fs::rename(&library.path, &moved).unwrap(); library.path = moved.to_string_lossy().into_owned();
        let reopened = read_library(&library).unwrap().0;
        assert_eq!(reopened.config.projects[0].remarkable_folders[0].name, "Work");
        assert!(reopened.config.projects[0].folders[0].starts_with(&library.path));
    }
    #[test]
    fn libraries_are_isolated_and_stale_or_foreign_saves_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let mut work = setup(&parent, "Work");
        let mut personal = setup(&parent, "Personal");
        let mut incoming = read_library(&work).unwrap().0;
        new_project(&mut incoming, "same-id");
        assert!(write_library(&mut personal, &incoming, &HashSet::new()).is_err());
        let first = write_library(&mut work, &incoming, &HashSet::new()).unwrap();
        assert!(read_library(&personal).unwrap().0.config.projects.is_empty());
        let path = Path::new(&work.path).join("projects/research/project.json");
        let mut disk: ProjectFile = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        disk.name = "Edited by Git".into(); write_json(&path, &disk).unwrap();
        let allowed = first.config.projects[0].folders.clone().into_iter().collect();
        assert!(write_library(&mut work, &first, &allowed).is_err());
        assert_eq!(read_library(&work).unwrap().0.config.projects[0].name, "Edited by Git");
    }
    #[test]
    fn creation_and_invalid_metadata_never_overwrite_existing_folders() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let library = setup(&parent, "Work");
        assert!(create_at(&parent, "Work").is_err());
        assert!(create_at(&parent, "../Outside").is_err());
        assert!(relative_path(&parent, "../Outside").is_err());
        assert!(relative_path(&parent, "/etc").is_err());
        assert!(relative_path(&parent, "C:\\notes").is_err());
        let path = Path::new(&library.path).join("library.json");
        let mut data: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        data["formatVersion"] = 99.into(); write_json(&path, &data).unwrap();
        assert!(read_library(&library).is_err());
        assert!(fs::read_to_string(&path).unwrap().contains("99"));
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_in_portable_metadata_cannot_grant_external_access() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let library = setup(&parent, "Work");
        symlink(&parent, Path::new(&library.path).join("outside")).unwrap();
        assert!(relative_path(Path::new(&library.path), "outside/secret.md").is_err());
        symlink(&parent, Path::new(&library.path).join("projects/escape")).unwrap();
        assert!(read_library(&library).is_err());
    }
    #[test]
    fn project_import_preserves_original_notes_and_legacy_configuration() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().canonicalize().unwrap();
        let external = parent.join("ExistingNotes"); fs::create_dir(&external).unwrap();
        fs::write(external.join("note.md"), "Original note").unwrap();
        let external = external.to_string_lossy().into_owned();
        let legacy = Projects { active: Some("old-project".into()), projects: vec![Project { id: "old-project".into(), name: "Existing work".into(), description: "".into(), color: "sage".into(), pinned: true, archived: false, folders: vec![external.clone()], default_folder: Some(external.clone()), remarkable_folders: vec![], remarkable_sync: vec![], icon: projects::default_project_icon() }] };
        let legacy_path = parent.join("projects.json"); projects::store(&legacy_path, &legacy).unwrap();
        let original = fs::read(&legacy_path).unwrap();
        let mut library = setup(&parent, "Library");
        let mut incoming = read_library(&library).unwrap().0;
        incoming.config = projects::load(&legacy_path).unwrap();
        let result = write_library(&mut library, &incoming, &HashSet::from([external.clone()])).unwrap();
        assert_eq!(result.config.projects[0].default_folder.as_ref(), Some(&external));
        assert_eq!(fs::read(&legacy_path).unwrap(), original);
        assert_eq!(fs::read_to_string(Path::new(&external).join("note.md")).unwrap(), "Original note");
    }
}
