import { useProjectScope } from "./useProjectScope";
import { recentDocuments } from "./home";
import { ResizableFileBrowser } from "./ResizableFileBrowser";
import { FolderBrowser } from "./DocumentsView";
import { scopeResources } from "./projectScope";
import { DocumentActions } from "./DocumentActions";
import { DocumentIcon } from "./DocumentIcon";
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { compareTodoUrgency } from "./todos";
import { TodoMetadata } from "./TodoMetadata";
import {
  Archive,
  FolderKanban,
  FolderOpen,
  Plus,
  Search,
  Settings,
  Pin,
  RefreshCw,
  Link2,
  Copy,
  PencilLine,
  ArrowUpRight,
} from "lucide-react";
import { RemarkableFolderPicker } from "./RemarkableFolderPicker";
import { ProjectIcon, projectIcons } from "./ProjectIcon";
import type { RemarkableScopeData } from "./useRemarkableScope";
import { desktop, type Folder } from "./api";
import {
  folderName,
  displayFolder,
  projectColors,
  removeFolder,
  resourceKey,
  type Project,
  type Projects,
  type ProjectTodo,
} from "./projects";

export function ProjectsView({
  title = "Projects",
  overviewOnly = false,
  config,
  cloud,
  folders,
  busy,
  save,
  choose,
  open,
  create,
  addItem,
  toggle,
  onEditing,
  openSettings,
  reader,
  selectedResource,
}: {
  reader?: ReactNode;
  selectedResource?: string;
  title?: string;
  overviewOnly?: boolean;
  onEditing: (editing: boolean) => void;
  openSettings: () => void;
  config: Projects;
  cloud: RemarkableScopeData & { refresh: () => void };
  folders: Folder[];
  busy: boolean;
  save: (next: Projects, activate?: boolean) => Promise<boolean>;
  choose: () => Promise<Folder | null>;
  open: (folder: string, path: string, page?: number) => void;
  create: (folder: string) => void;
  addItem: (folder: string, kind: "task" | "link", text: string, url: string) => Promise<boolean>;
  toggle: (task: ProjectTodo) => Promise<boolean>;
}) {
  const project = config.projects.find(
    (p) => p.id === config.active && !p.archived,
  );
  const [draft, setDraft] = useState<Project | null>(null);
  useEffect(() => {
    onEditing(!!draft);
    return () => onEditing(false);
  }, [!!draft, onEditing]);
  const folderLabel = (path: string) => {
    const owner = draft ?? project;
    const homeProject = config.library && [owner, ...config.projects].find((candidate) =>
      candidate && candidate.folders.includes(path) && path.startsWith(`${config.library}/projects/`) && !path.slice(`${config.library}/projects/`.length).includes("/"),
    );
    return homeProject
      ? homeProject.id === owner?.id ? "Project folder" : `Project folder · ${homeProject.name}`
      : folderName(path);
  };
  const [adding, setAdding] = useState<"task" | "link" | null>(null);
  const [itemText, setItemText] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "files" | "remarkable" | "tasks" | "links">(
    "all",
  );
  const pinsKey = `notesdive:project-pins:${config.library ?? "legacy"}:${project?.id ?? ""}`;
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    try { const value: unknown = JSON.parse(localStorage.getItem(pinsKey) ?? "[]"); setPins(Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : []); }
    catch { setPins([]); }
  }, [pinsKey]);
  const pinResource = (key: string) => setPins((previous) => {
    const next = previous.includes(key) ? previous.filter((value) => value !== key) : [...previous, key];
    try { localStorage.setItem(pinsKey, JSON.stringify(next)); } catch { /* Pinning still works for this session. */ }
    return next;
  });
  const [fileExpanded, setFileExpanded] = useState(new Set<string>());
  const [rmExpanded, setRmExpanded] = useState(new Set<string>());
  const [fileFolder, setFileFolder] = useState<string | null>(null);
  const [rmFolder, setRmFolder] = useState<string | null>(null);
  const [streamFilter, setStreamFilter] = useState<"all" | "files" | "remarkable" | "tasks" | "links">("all");
  const [taskMode, setTaskMode] = useState<"open" | "done" | "all">("open");
  const [sort, setSort] = useState("modified");
  const [archived, setArchived] = useState(false);
  const localData = useProjectScope(project, config.library ?? null, query);
  const { loading, refresh: refreshLocal } = localData;
  const cloudEntries = cloud.entries.filter((entry) => `${entry.name} ${entry.path} ${folderName(entry.folder)}`.toLowerCase().includes(query.toLowerCase().trim()));
  const data = { ...localData, entries: [...localData.entries, ...cloudEntries].sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path)),
    tasks: [...localData.tasks, ...cloud.tasks], warnings: [...localData.warnings, ...cloud.warnings] };
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [limit, setLimit] = useState(60);
  const [newFolder, setNewFolder] = useState("");
  const folderKey = JSON.stringify(project?.folders ?? []);
  useEffect(() => {
    setFileFolder(null); setRmFolder(null); setFileExpanded(new Set()); setRmExpanded(new Set()); setStreamFilter("all");
    setAdding(null);
    setQuery("");
    setCopied("");
    setFilter("all");
    setLimit(60);
  }, [project?.id, folderKey]);
  useEffect(() => {
    setLimit(60);
    setCopied("");
  }, [query, filter]);
  useEffect(
    () => setNewFolder(project?.defaultFolder ?? ""),
    [project?.id, project?.defaultFolder],
  );
  const run = async (action: () => Promise<void>) => {
    if (working || busy) return;
    setWorking(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  };
  const locked = busy || working;
  const updateProject = (
    next: Project,
    reconnections?: Projects["reconnections"],
  ) =>
    save({
      reconnections,
      active: next.archived && config.active === next.id ? null : config.active,
      projects: config.projects.map((p) => (p.id === next.id ? next : p)),
    });
  const newProject = () =>
    setDraft({
      id: crypto.randomUUID(),
      name: "",
      description: "",
      color: "orange",
      pinned: false,
      archived: false,
      folders: [],
      defaultFolder: null,
    });
  const select = (id: string) =>
    void run(async () => {
      if (await save({ ...config, active: id }, true)) {
        setDraft(null);
        setArchived(false);
      }
    });
  const shown = config.projects
    .filter((p) => p.archived === archived)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name),
    );
  const firstAvailableProject = shown.find((p) => !p.archived);
  const visibleTasks = data.tasks.filter(
    (t) =>
      (filter !== "tasks" ? !t.checked : taskMode === "all" || t.checked === (taskMode === "done")) &&
      `${t.text} ${t.path} ${t.folder}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  ).sort(compareTodoUrgency);
  const visibleLinks = data.links.filter((link) =>
    `${link.label} ${link.url} ${link.path} ${folderLabel(link.folder)}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  const fileScope = project ? scopeResources(project, localData.inventory, [], [], new Map(project.folders.map((folder) => [folder, folderLabel(folder)])), localData.directories) : null;
  const rmScope = project ? scopeResources({ ...project, folders: [] }, cloud.entries, [], cloud.folders) : null;
  const openInDocumentTab = (folder: string, path: string, page?: number) => {
    const remarkable = folder.startsWith("remarkable:");
    const scope = remarkable ? rmScope : fileScope;
    const root = [...(scope?.rootFolders ?? [])].find(([, source]) => source === folder)?.[0];
    if (root) {
      const parts = [root, ...path.split("/").slice(0, -1)];
      const directory = parts.join("/");
      const expand = (previous: Set<string>) => new Set([...previous, ...parts.map((_, index) => parts.slice(0, index + 1).join("/"))]);
      if (remarkable) { setRmFolder(directory); setRmExpanded(expand); }
      else { setFileFolder(directory); setFileExpanded(expand); }
    }
    setQuery("");
    setFilter(remarkable ? "remarkable" : "files");
    open(folder, path, page);
  };
  const treeScope = filter === "remarkable" ? rmScope : fileScope;
  const selectedFolder = filter === "remarkable" ? rmFolder : fileFolder;
  const selectedRoot = selectedFolder ? treeScope?.rootFolders.get(selectedFolder.split("/")[0]) : undefined;
  const selectedPath = selectedFolder?.split("/").slice(1).join("/") ?? "";
  const displayedEntries = (filter === "remarkable" ? cloudEntries : localData.entries).filter((entry) =>
    !selectedFolder || (entry.folder === selectedRoot && entry.path.split("/").slice(0, -1).join("/") === selectedPath))
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : b.modified - a.modified || a.path.localeCompare(b.path));
  const sourceModified = (folder: string, path: string) => [...localData.inventory, ...cloud.entries].find((entry) => entry.folder === folder && entry.path === path)?.modified ?? 0;
  const streamEntries = [
    ...data.entries.filter((entry) => !/^(readme|links|todo)\.(md|markdown)$/i.test(entry.path.split("/").pop() ?? "")).map((entry) => ({
      ...entry, kind: entry.remarkableId ? "remarkable" : "files", key: resourceKey(entry.folder, entry.path), title: entry.name,
      detail: entry.remarkableId ? "reMarkable note" : "Document updated", page: undefined as number | undefined,
    })),
    ...visibleTasks.map((task) => ({ ...task, modified: sourceModified(task.folder, task.path), name: task.text, snippet: null,
      kind: "tasks", key: `${resourceKey(task.folder, task.path)}:task:${task.offset}`, title: task.text, detail: "Open task · Source updated", page: task.page })),
    ...visibleLinks.map((link) => ({ ...link, remarkableId: undefined, modified: sourceModified(link.folder, link.path), name: link.label, snippet: null,
      kind: "links", key: `${resourceKey(link.folder, link.path)}:link:${link.url}`, title: link.label, detail: "Project link · Source updated", page: undefined })),
  ].filter((entry) => streamFilter === "all" || entry.kind === streamFilter).sort((a, b) => b.modified - a.modified || a.key.localeCompare(b.key));
  const dateLabel = (modified: number) => modified > 0 ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(modified)) : "Date unavailable";
  return (
    <section
      className="workspace-page projects-page"
      aria-label="Projects workspace"
    >
      <div className="page-heading">
        <h1>{title}</h1>
        {!overviewOnly && <button
          className="quiet-button"
          onClick={newProject}
          disabled={locked || !!draft || !config.library}
        >
          <Plus size={16} /> New project
        </button>}
      </div>
      {(error || localData.error) && (
        <p className="notice" role="alert">
          {error || localData.error}
        </p>
      )}
      <div className={`project-layout${overviewOnly ? " project-single" : ""}`}>
        {!overviewOnly && <aside className="project-list" aria-label="Your projects">
          <div className="task-filters">
            <button aria-pressed={!archived} onClick={() => setArchived(false)}>
              Active
            </button>
            <button aria-pressed={archived} onClick={() => setArchived(true)}>
              Archived
            </button>
          </div>
          {shown.map((p) => (
            <div
              className={`project-card project-${p.color} ${project?.id === p.id ? "selected" : ""}`}
              key={p.id}
            >
              <button
                className="project-select"
                disabled={locked || !!draft || p.archived}
                onClick={() => select(p.id)}
                aria-current={project?.id === p.id ? "true" : undefined}
              >
                <ProjectIcon icon={p.icon} size={19} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.folders.length + (p.remarkableFolders?.length ?? 0)} folders {p.pinned ? "· Pinned" : ""}
                  </small>
                </span>
              </button>
              {p.archived && (
                <button
                  className="quiet-button"
                  disabled={locked}
                  onClick={() =>
                    void run(async () => {
                      await updateProject({ ...p, archived: false });
                    })
                  }
                >
                  Restore project
                </button>
              )}
            </div>
          ))}
          {!shown.length && (
            <p className="home-empty">
              {archived
                ? "No archived projects."
                : "Create a project and attach your folders."}
            </p>
          )}
        </aside>}
        <div className="project-detail">
          {draft ? (
            <form
              className="project-settings"
              aria-label="Project settings"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const next = {
                    ...draft,
                    name: draft.name.trim(),
                    description: draft.description.trim(),
                  };
                  const exists = config.projects.some((p) => p.id === next.id);
                  if (!exists && config.library) {
                    const slug =
                      next.name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "")
                        .slice(0, 40) || "project";
                    next.id = `${slug}-${next.id}`;
                  }
                  if (
                    await save({
                      active: next.id,
                      projects: exists
                        ? config.projects.map((p) =>
                            p.id === next.id ? next : p,
                          )
                        : [...config.projects, next],
                    }, true)
                  )
                    setDraft(null);
                });
              }}
            >
              <h2>
                {config.projects.some((p) => p.id === draft.id)
                  ? "Project settings"
                  : "Create a project"}
              </h2>
              <label>
                Name
                <input
                  autoFocus
                  required
                  maxLength={200}
                  value={draft.name}
                  disabled={locked}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                Project goal / Description
                <textarea
                  placeholder="What do you want to achieve with this project?"
                  rows={3}
                  value={draft.description}
                  disabled={locked}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <label>
                Color
                <select
                  value={draft.color}
                  disabled={locked}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      color: e.target.value as Project["color"],
                    })
                  }
                >
                  {projectColors.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}
                </select>
              </label>
              <fieldset className={`project-icon-picker project-${draft.color}`} disabled={locked}>
                <legend>Icon</legend>
                <div role="group" aria-label="Project icon">
                  {projectIcons.map(({ value, label, Icon }) => <button key={value} type="button"
                    aria-label={`Project icon ${label}`} title={label} aria-pressed={(draft.icon ?? "folder") === value}
                    onClick={() => setDraft({ ...draft, icon: value })}><Icon size={19} aria-hidden="true" /></button>)}
                </div>
              </fieldset>
              <fieldset disabled={locked}>
                <legend>Attached folders</legend>
                {!config.projects.some((p) => p.id === draft.id) &&
                  config.library && (
                    <p className="home-empty">
                      A project folder with README.md, todo.md, links.md, notes and
                      attachments will be created inside your library. Add
                      existing folders below if needed.
                    </p>
                  )}
                {[
                  ...new Set([...folders.map((f) => f.path), ...draft.folders]),
                ].map((path) => (
                  <label className="project-folder-choice" key={path}>
                    <input
                      type="checkbox"
                      checked={draft.folders.includes(path)}
                      onChange={(e) =>
                        setDraft(
                          e.target.checked
                            ? {
                                ...draft,
                                folders: [...draft.folders, path],
                                defaultFolder: draft.defaultFolder ?? path,
                              }
                            : removeFolder(draft, path),
                        )
                      }
                    />
                    <span>
                      <strong>{folderLabel(path)}</strong>
                      <small>{displayFolder(path)}</small>
                    </span>
                  </label>
                ))}
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() =>
                    void run(async () => {
                      const folder = await choose();
                      if (folder)
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                folders: [
                                  ...new Set([...d.folders, folder.path]),
                                ],
                                defaultFolder: d.defaultFolder ?? folder.path,
                              }
                            : d,
                        );
                    })
                  }
                >
                  <Plus size={15} /> Add folder from disk
                </button>
              </fieldset>
              <label>
                Default folder for new notes
                <select
                  value={draft.defaultFolder ?? ""}
                  disabled={locked}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      defaultFolder: e.target.value || null,
                    })
                  }
                >
                  <option value="">Choose when creating</option>
                  {draft.folders.map((path) => (
                    <option key={path} value={path}>
                      {folderLabel(path)}
                    </option>
                  ))}
                </select>
              </label>
              {draft.defaultFolder && <p className="project-field-hint">{displayFolder(draft.defaultFolder)}</p>}
              <RemarkableFolderPicker linked={draft.remarkableFolders ?? []} disabled={locked}
                change={(remarkableFolders) => setDraft({ ...draft, remarkableFolders,
                  remarkableSync: draft.remarkableSync?.filter((link) => remarkableFolders.some((folder) => folder.id === link.remoteParentId)) })} />
              <p className="home-empty">
                Folders can belong to several projects. Detaching a folder or
                archiving a project keeps every file on disk.
              </p>
              <div className="project-actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={locked || !draft.name.trim()}
                >
                  Save project
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : project ? (
            <>
              <div className={`project-heading project-${project.color}`}>
                <div>
                  <h2><ProjectIcon icon={project.icon} size={22} />{project.name}</h2>
                </div>
                <div className="project-actions">
                  <button
                    title={project.pinned ? "Unpin project" : "Pin project"}
                    aria-label={
                      project.pinned ? "Unpin project" : "Pin project"
                    }
                    aria-pressed={project.pinned}
                    disabled={locked}
                    onClick={() =>
                      void run(async () => {
                        await updateProject({
                          ...project,
                          pinned: !project.pinned,
                        });
                      })
                    }
                  >
                    <Pin size={16} />
                  </button>
                  <button
                    disabled={locked}
                    onClick={() =>
                      setDraft({ ...project, folders: [...project.folders] })
                    }
                  >
                    <Settings size={16} /> Settings
                  </button>
                  <button
                    title="Archive project (files stay on disk)"
                    aria-label="Archive project"
                    disabled={locked}
                    onClick={() =>
                      void run(async () => {
                        await updateProject({ ...project, archived: true });
                      })
                    }
                  >
                    <Archive size={16} />
                  </button>
                </div>
              </div>
              <div className="project-purpose project-subtitle">
                <button disabled={locked} onClick={() => setDraft({ ...project, folders: [...project.folders] })} title="Edit project goal">{project.description || "Add a project goal"}</button>
              </div>
              <div className="project-actions project-toolbar">
                <label className="task-search project-search">
                  <Search size={16} />
                  <input
                    aria-label="Search project"
                    placeholder="Find documents, tasks and links…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                {!project.defaultFolder && (
                  <select
                    aria-label="New note destination"
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                  >
                    <option value="">Choose a folder for the new note</option>
                  {project.folders.map((path) => (
                      <option key={path} value={path}>
                        {folderLabel(path)} — {displayFolder(path)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  disabled={locked || !project.folders.includes(newFolder)}
                  onClick={() => create(newFolder)}
                >
                  <Plus size={15} /> New project note
                </button>
                <button
                  disabled={locked || loading || cloud.loading}
                  onClick={() => { cloud.refresh(); refreshLocal(); }}
                >
                  <RefreshCw size={15} /> Refresh
                </button>
              </div>
              <div className="todo-controls">
                <div className="task-filters" role="tablist" aria-label="Project views">
                  {(["all", "files", "remarkable", "tasks", "links"] as const).map(
                    (value) => (
                      <button
                        key={value}
                        role="tab"
                        aria-selected={filter === value}
                        aria-pressed={filter === value}
                        tabIndex={filter === value ? 0 : -1}
                        onKeyDown={(event) => {
                          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                          event.preventDefault();
                          const values = ["all", "files", "remarkable", "tasks", "links"] as const;
                          const index = event.key === "Home" ? 0 : event.key === "End" ? values.length - 1 : (values.indexOf(value) + (event.key === "ArrowRight" ? 1 : -1) + values.length) % values.length;
                          setFilter(values[index]);
                          (event.currentTarget.parentElement?.children[index] as HTMLElement)?.focus();
                        }}
                        onClick={() => setFilter(value)}
                      >
                        {value === "all"
                          ? "Overview"
                          : value === "files"
                            ? "Files"
                            : value === "remarkable"
                              ? "reMarkable"
                              : value === "tasks"
                              ? "Tasks"
                              : "Links"} {value !== "all" && <span className="heading-count">{value === "files" ? localData.inventory.length : value === "remarkable" ? cloud.entries.length : value === "tasks" ? visibleTasks.length : visibleLinks.length}</span>}
                      </button>
                    ),
                  )}
                </div>
                <span className="project-scope">
                  Across {project.folders.length + (project.remarkableFolders?.length ?? 0)} linked folders
                </span>
              </div>
              {(loading || cloud.loading) && <p role="status">Checking project folders…</p>}
              {cloud.tasksLoading && <p role="status">Reading reMarkable checkbox tasks…</p>}
              {data.warnings.length > 0 && (
                <details className="project-warnings">
                  <summary>
                    {data.warnings.length} folder or file warnings
                  </summary>
                  {data.warnings.map((warning, i) => (
                    <p key={i}>{warning}</p>
                  ))}
                </details>
              )}
              {adding && <form className="project-quick-add" onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  if (await addItem(newFolder, adding, itemText.trim(), itemUrl.trim())) {
                    setAdding(null); refreshLocal();
                  }
                });
              }}>
                <strong>{adding === "task" ? "New task" : "New link"}</strong>
                <input autoFocus required aria-label={adding === "task" ? "Task" : "Link title"} placeholder={adding === "task" ? "What needs to be done?" : "Link title"} value={itemText} onChange={(event) => setItemText(event.target.value)} disabled={locked} />
                {adding === "link" && <input required type="url" pattern="https?://.*" aria-label="Link URL" placeholder="https://…" value={itemUrl} onChange={(event) => setItemUrl(event.target.value)} disabled={locked} />}
                <select aria-label="Destination folder" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} disabled={locked}>
                  <option value="">Choose a folder</option>
                  {project.folders.map((path) => <option key={path} value={path}>{folderLabel(path)} — {displayFolder(path)}</option>)}
                </select>
                <button disabled={locked || !itemText.trim() || !project.folders.includes(newFolder)}><Plus size={15} /> Add {adding}</button>
                <button type="button" disabled={locked} onClick={() => setAdding(null)}>Cancel</button>
              </form>}
              <div className={`project-content-workspace ${reader ? "has-reader" : ""}`}>
              <div
                className={`project-cockpit ${filter === "all" ? "overview" : ""}`}
              >
                {filter === "all" && <section className="project-panel project-stream project-files-panel" aria-label="Project files">
                  <div className="project-panel-heading"><h3>Project stream</h3><span className="project-scope">Sorted by source changes</span><button className="icon-button" title="New note" aria-label="New note" disabled={locked || !project.folders.includes(newFolder)} onClick={() => create(newFolder)}><Plus size={17} /></button></div>
                  <div className="task-filters stream-filters" aria-label="Stream filter">{(["all", "files", "remarkable", "tasks", "links"] as const).map((value) => <button key={value} aria-pressed={streamFilter === value} onClick={() => setStreamFilter(value)}>{value === "all" ? "All activity" : value === "files" ? "Documents" : value === "remarkable" ? "reMarkable" : value === "tasks" ? "Tasks" : "Links"}</button>)}</div>
                  <div className="recent-notes project-stream-list">{streamEntries.slice(0, limit).map((entry) => <button key={entry.key} disabled={locked} onClick={() => { if (entry.kind === "links") { setFilter("links"); } else openInDocumentTab(entry.folder, entry.path, entry.page); }}>{entry.kind === "links" ? <Link2 size={20} /> : <DocumentIcon path={entry.path} remarkable={!!entry.remarkableId} />}<span><small className="stream-date">{dateLabel(entry.modified)}</small><strong>{entry.title}</strong><small>{entry.detail} · {folderLabel(entry.folder)} · {entry.path}</small></span><ArrowUpRight size={14} /></button>)}</div>
                  {!streamEntries.length && !loading && <p className="home-empty">No project activity to show yet.</p>}
                  {streamEntries.length > limit && <button className="project-view-all" onClick={() => setLimit((n) => n + 60)}>Show more activity</button>}
                </section>}
                {(filter === "files" || filter === "remarkable") && (
                  <section
                    className="project-panel project-files-panel"
                    aria-label={filter === "remarkable" ? "Project reMarkable documents" : "Project files"}
                  >
                    <div className="project-panel-heading">
                      <h3>
                        {filter === "remarkable"
                          ? "reMarkable documents"
                          : query
                          ? "Matching files"
                          : "All project files"}{" "}
                        <span className="heading-count">
                          {displayedEntries.length}
                        </span>
                      </h3>
                      {filter !== "remarkable" && <button className="icon-button" title="New note" aria-label="New note" disabled={locked || !project.folders.includes(newFolder)} onClick={() => create(newFolder)}><Plus size={17} /></button>}
                    </div>
                    <p className="project-panel-hint">
                      {filter === "remarkable" ? "Read-only documents from this project’s linked reMarkable folders and their subfolders." : "Open a document to read or edit it."}
                    </p>
                    <div className="project-file-controls"><span>{selectedFolder ?? (filter === "remarkable" ? "All notes" : "All files")}</span><select aria-label="Sort project files" value={sort} onChange={(event) => setSort(event.target.value)}><option value="modified">Last modified</option><option value="name">Name</option></select></div>
                    <ResizableFileBrowser>
                    <aside className="project-tree" aria-label="Project folder tree">
                      <div hidden={filter !== "files"}>{fileScope && <FolderBrowser expandedFolders={fileExpanded} onExpandedFolders={setFileExpanded} entries={fileScope.entries} roots={fileScope.folders} directories={fileScope.directories} selected={fileFolder} recent={false} busy={locked} select={setFileFolder} />}</div>
                      <div hidden={filter !== "remarkable"}>{rmScope && <FolderBrowser expandedFolders={rmExpanded} onExpandedFolders={setRmExpanded} entries={rmScope.entries} roots={rmScope.folders} selected={rmFolder} recent={false} busy={locked} select={setRmFolder} />}</div>
                    </aside>
                    <div className="recent-notes">
                      {displayedEntries
                        .slice(0, limit)
                        .map((entry) => (
                          <DocumentActions key={resourceKey(entry.folder, entry.path)} folder={entry.remarkableId ? undefined : entry.folder} path={entry.path} disabled={locked}><button
                            disabled={locked}
                            aria-current={selectedResource === resourceKey(entry.folder, entry.path) ? "true" : undefined}
                            onClick={() => open(entry.folder, entry.path)}
                          >
                            <DocumentIcon path={entry.path} remarkable={!!entry.remarkableId} />
                            <span
                              title={`${displayFolder(entry.folder)} / ${entry.path}`}
                            >
                              <strong>{entry.name}</strong>
                              <small>
                                {folderLabel(entry.folder)} · {entry.path}
                              </small>
                              <small>{dateLabel(entry.modified)}</small>
                              {entry.snippet && <small>{entry.snippet}</small>}
                            </span>
                          </button><button className="icon-button" aria-label={`${pins.includes(resourceKey(entry.folder, entry.path)) ? "Unpin" : "Pin"} ${entry.name}`} aria-pressed={pins.includes(resourceKey(entry.folder, entry.path))} onClick={() => pinResource(resourceKey(entry.folder, entry.path))}><Pin size={14} /></button></DocumentActions>
                        ))}
                    </div>
                    </ResizableFileBrowser>
                    {!(filter === "remarkable" ? cloud.loading : loading || cloud.loading) && !displayedEntries.length && (
                      <div className="home-empty">
                        <p>{filter === "remarkable" ? project.remarkableFolders?.length ? "No matching reMarkable documents in this project." : "No reMarkable folders linked to this project yet." : "No matching files in this project."}</p>
                        {filter === "remarkable" && !project.remarkableFolders?.length && <button className="quiet-button" disabled={locked} onClick={() => setDraft({ ...project })}>Link reMarkable folders</button>}
                      </div>
                    )}
                    {(filter === "files" || filter === "remarkable") && displayedEntries.length > limit && (
                      <button onClick={() => setLimit((n) => n + 60)}>
                        Show more files
                      </button>
                    )}
                  </section>
                )}
                {(filter === "all" || filter === "tasks") && (
                  <section
                    className="project-panel project-tasks-panel"
                    aria-label="Project tasks"
                  >
                    <div className="project-panel-heading">
                      <h3>
                        {filter === "tasks" && taskMode !== "open" ? taskMode === "done" ? "Completed tasks" : "All tasks" : "Open tasks"}{" "}
                        <span className="heading-count">
                          {visibleTasks.length}
                        </span>
                      </h3>
                      <button className="icon-button" title="New task" aria-label="New task" disabled={locked || !project.folders.includes(newFolder)} onClick={() => { setAdding("task"); setItemText(""); setItemUrl(""); }}><Plus size={17} /></button>
                    </div>
                    <p className="project-panel-hint">
                      Your next steps, collected from every linked folder.
                    </p>
                    {filter === "tasks" && <div className="task-filters" aria-label="Task status">{(["open", "done", "all"] as const).map((mode) => <button key={mode} aria-pressed={taskMode === mode} onClick={() => setTaskMode(mode)}>{mode === "open" ? "Open" : mode === "done" ? "Completed" : "All"}</button>)}</div>}
                    <div className="project-tasks">
                      {visibleTasks
                        .slice(0, filter === "all" ? 4 : limit)
                        .map((task) => (
                          <div
                            key={`${resourceKey(task.folder, task.path)}:${task.offset}`}
                          >
                            <input
                              type="checkbox"
                              aria-label={`${task.checked ? "Reopen" : "Complete"} ${task.text} in ${folderName(task.folder)}`}
                              checked={task.checked}
                              disabled={locked || task.readOnly}
                              onChange={() =>
                                void run(async () => {
                                  await toggle(task);
                                  refreshLocal();
                                })
                              }
                            />
                            <button
                              disabled={locked}
                              onClick={() => openInDocumentTab(task.folder, task.path, task.page)}
                            >
                              <strong>{task.text}</strong>
                              <TodoMetadata task={task} />
                              <small
                                title={`${displayFolder(task.folder)} / ${task.path}`}
                              >
                                {folderLabel(task.folder)} · {task.path}{task.readOnly && " · Read only"}
                              </small>
                            </button>
                          </div>
                        ))}
                    </div>
                    {!loading && !visibleTasks.length && (
                      <p className="home-empty">
                        No tasks match this view.
                      </p>
                    )}
                    {filter === "all" && visibleTasks.length > 4 && (
                      <button
                        className="project-view-all"
                        onClick={() => setFilter("tasks")}
                      >
                        View all {visibleTasks.length} tasks{" "}
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                    {filter === "tasks" && visibleTasks.length > limit && (
                      <button onClick={() => setLimit((n) => n + 60)}>
                        Show more tasks
                      </button>
                    )}
                  </section>
                )}
                {(filter === "all" || filter === "links") && (
                  <section
                    className="project-panel project-links-panel"
                    aria-label="Project links"
                  >
                    <div className="project-panel-heading">
                      <h3>
                        <Link2 size={16} /> Links{" "}
                        <span className="heading-count">
                          {visibleLinks.length}
                        </span>
                      </h3>
                      <div className="project-link-sources">
                        <button className="icon-button" title="New link" aria-label="New link" disabled={locked || !project.folders.includes(newFolder)} onClick={() => { setAdding("link"); setItemText(""); setItemUrl(""); }}><Plus size={17} /></button>
                        {data.linkFiles.map((file) => (
                          <button
                            disabled={locked}
                            key={resourceKey(file.folder, file.path)}
                            title={`${displayFolder(file.folder)} / ${file.path}`}
                            onClick={() => open(file.folder, file.path)}
                          >
                            Edit links
                            {data.linkFiles.length > 1
                              ? ` · ${folderLabel(file.folder)}`
                              : ""}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="project-panel-hint">
                      Open a link in your browser. Use the pencil to edit its
                      source.
                    </p>
                    <div className="project-links">
                      {visibleLinks
                        .slice(0, filter === "all" ? 4 : limit)
                        .map((link) => (
                          <div
                            className="project-link"
                            key={`${resourceKey(link.folder, link.path)}:${link.url}`}
                          >
                            <ArrowUpRight size={16} />
                            <a
                              className="project-link-label"
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-disabled={locked || undefined}
                              tabIndex={locked ? -1 : undefined}
                              title={`Open ${link.url} in your browser`}
                              onClick={(event) => {
                                if (locked || desktop) event.preventDefault();
                                if (!locked && desktop)
                                  void run(() =>
                                    invoke("open_web_link", { url: link.url }),
                                  );
                              }}
                              onAuxClick={(event) => {
                                if (event.button !== 1) return;
                                if (locked || desktop) event.preventDefault();
                                if (!locked && desktop)
                                  void run(() =>
                                    invoke("open_web_link", { url: link.url }),
                                  );
                              }}
                            >
                              <strong>{link.label}</strong>
                              <small>{link.url}</small>
                            </a>
                            <button className="icon-button" aria-label={`${pins.includes(resourceKey(link.folder, `${link.path}:${link.url}`)) ? "Unpin" : "Pin"} link ${link.label}`} aria-pressed={pins.includes(resourceKey(link.folder, `${link.path}:${link.url}`))} onClick={() => pinResource(resourceKey(link.folder, `${link.path}:${link.url}`))}><Pin size={14} /></button>
                            <button
                              className="icon-button"
                              title={`Edit in ${folderLabel(link.folder)} / ${link.path}`}
                              aria-label={`Edit link ${link.label} in ${folderLabel(link.folder)}`}
                              disabled={locked}
                              onClick={() => openInDocumentTab(link.folder, link.path)}
                            >
                              <PencilLine size={14} />
                            </button>
                            <button
                              className="icon-button"
                              title={`Copy ${link.url}`}
                              aria-label={`Copy link ${link.label}`}
                              onClick={() =>
                                void run(async () => {
                                  await navigator.clipboard.writeText(link.url);
                                  setCopied(`Copied ${link.label}`);
                                })
                              }
                              disabled={locked}
                            >
                              <Copy size={14} />
                            </button>
                          </div>
                        ))}
                    </div>
                    {copied && (
                      <p className="project-copy-status" role="status">
                        {copied}
                      </p>
                    )}
                    {!loading && !visibleLinks.length && (
                      <p className="home-empty">
                        {query
                          ? "No links match your search."
                          : "Add web links to links.md to keep your project references here."}
                      </p>
                    )}
                    {visibleLinks.length > (filter === "all" ? 4 : limit) && (
                      <button
                        className="project-view-all"
                        onClick={() =>
                          filter === "all"
                            ? setFilter("links")
                            : setLimit((n) => n + 60)
                        }
                      >
                        {filter === "all"
                          ? `View all ${visibleLinks.length} links`
                          : "Show more links"}{" "}
                        <ArrowUpRight size={14} />
                      </button>
                    )}
                  </section>
                )}
                {filter === "all" && <section className="project-panel project-resume-panel" aria-label="Continue working">
                  <h3>Continue working</h3><div className="recent-notes">{(() => {
                    const inventory = [...localData.inventory, ...cloud.entries];
                    const history = recentDocuments().map((recent) => inventory.find((entry) => entry.folder === recent.folder && entry.path === recent.path)).filter((entry) => !!entry);
                    const entries = history.length ? history : [...inventory].sort((a, b) => b.modified - a.modified);
                    return entries.slice(0, 3).map((entry) => <button key={resourceKey(entry.folder, entry.path)} disabled={locked} onClick={() => openInDocumentTab(entry.folder, entry.path)}><DocumentIcon path={entry.path} remarkable={!!entry.remarkableId} /><span><strong>{entry.name}</strong><small>{folderLabel(entry.folder)}</small></span></button>);
                  })()}</div>
                  <h3 className="project-pinned-heading"><Pin size={14} /> Pinned</h3><div className="recent-notes">{[...localData.inventory, ...cloud.entries].filter((entry) => pins.includes(resourceKey(entry.folder, entry.path))).map((entry) => <button key={resourceKey(entry.folder, entry.path)} disabled={locked} onClick={() => openInDocumentTab(entry.folder, entry.path)}><DocumentIcon path={entry.path} remarkable={!!entry.remarkableId} /><span><strong>{entry.name}</strong><small>{folderLabel(entry.folder)}</small></span></button>)}</div>
                  <div className="project-links">{data.links.filter((link) => pins.includes(resourceKey(link.folder, `${link.path}:${link.url}`))).map((link) => <a className="project-link project-link-label" key={resourceKey(link.folder, `${link.path}:${link.url}`)} href={link.url} target="_blank" rel="noopener noreferrer" onClick={(event) => { if (desktop || locked) event.preventDefault(); if (desktop && !locked) void run(() => invoke("open_web_link", { url: link.url })); }}><Link2 size={14} /><span><strong>{link.label}</strong><small>{link.url}</small></span></a>)}</div>
                  {!pins.length && <p className="home-empty">Pin documents or links to keep them here.</p>}
                </section>}
              </div>
              {reader && <aside className="project-document-pane" aria-label="Project document">{reader}</aside>}
              </div>
              <details
                className="project-sources"
                key={`${project.id}:${data.unavailable.length}`}
                open={data.unavailable.length > 0}
              >
                <summary>
                  <FolderOpen size={15} /> Linked folders{" "}
                  <span>{project.folders.length + (project.remarkableFolders?.length ?? 0)}</span>
                </summary>
                <div className="project-folders">
                  {(project.remarkableFolders ?? []).map((link) => <div key={`remarkable:${link.id}`}><FolderOpen size={16} /><span><strong>reMarkable · {link.name}</strong><small>Includes subfolders · Read only</small></span></div>)}
                  {project.folders.map((path) => (
                    <div key={path}>
                      <FolderOpen size={16} />
                      <span>
                        <strong>{folderLabel(path)}</strong>
                        <small>{displayFolder(path)}</small>
                      </span>
                      {data.unavailable.includes(path) && (
                        <button
                          disabled={locked}
                          onClick={() =>
                            void run(async () => {
                              const replacement = await choose();
                              if (replacement) {
                                await updateProject(
                                  {
                                    ...project,
                                    folders: [
                                      ...new Set(
                                        project.folders.map((p) =>
                                          p === path ? replacement.path : p,
                                        ),
                                      ),
                                    ],
                                    defaultFolder:
                                      project.defaultFolder === path
                                        ? replacement.path
                                        : project.defaultFolder,
                                    remarkableSync: project.remarkableSync?.map((link) => link.localFolder === path
                                      ? { ...link, localFolder: replacement.path } : link),
                                  },
                                  [
                                    {
                                      projectId: project.id,
                                      from: path,
                                      to: replacement.path,
                                    },
                                  ],
                                );
                                refreshLocal();
                              }
                            })
                          }
                        >
                          Reconnect folder
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {!project.folders.length && !project.remarkableFolders?.length && (
                  <p className="home-empty">
                    Attach a folder in Settings to see its notes and tasks here.
                  </p>
                )}
              </details>
            </>
          ) : (
            <div className="project-empty">
              <FolderKanban size={36} />
              {!config.library && config.projects.length === 0 ? (
                <>
                  <h2>A home for your projects</h2>
                  <p>
                    Create or open a library in Settings, then add your projects
                    here.
                  </p>
                  <button
                    className="quiet-button"
                    disabled={locked}
                    onClick={openSettings}
                  >
                    Set up a library
                  </button>
                </>
              ) : config.projects.length > 0 ? (
                <>
                  <h2>Choose a project</h2>
                  <p>
                    Select a project on the left to see its folders, documents
                    and tasks. Archived projects can be restored from the
                    Archived list.
                  </p>
                  {firstAvailableProject && (
                    <button
                      className="quiet-button"
                      disabled={locked}
                      onClick={() => select(firstAvailableProject.id)}
                    >
                      Open {firstAvailableProject.name}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <h2>A place for the whole project</h2>
                  <p>
                    Group folders from different locations and find their
                    documents and tasks together.
                  </p>
                  <button
                    className="quiet-button"
                    onClick={newProject}
                    disabled={locked || !config.library}
                  >
                    Create your first project
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
