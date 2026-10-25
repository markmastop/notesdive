import { invoke } from "@tauri-apps/api/core";
import { DocumentActionContext, type DocumentAction } from "./DocumentActions";
import { useProjectTabs } from "./useProjectTabs";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  lazy,
  Suspense,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Home,
  Tablet,
  Settings,
  FolderKanban,
  Search,
  Maximize2,
  Minimize2,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Check,
  ChevronRight,
  Circle,
  FilePlus2,
  Download,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { api, desktop, knownFolderApi, type Asset, type Folder } from "./api";
import { fileKind } from "./fileTypes";
import { AssetViewer } from "./AssetViewer";
import { DocumentSession } from "./session";
import { watchFinderFiles } from "./finderFiles";
import { Editor } from "./Editor";
import { RichEditor } from "./RichEditor";
import { exportPdf } from "./pdfExport";
import { renderMarkdown } from "./markdown";
import { isMarp } from "./isMarp";
import { openWebLink } from "./webLinks";
import { showLocalImages } from "./localImages";
import brandMark from "../src-tauri/app-icon.svg?url";
import { UpdateNotice } from "./UpdateNotice";

import { toggleTodo, type Todo } from "./todos";
import { TodosView } from "./WorkspaceViews";
import { HomeView } from "./HomeView";
import { rememberDocument, rememberProject, type HomeData } from "./home";

import { LibrarySettings } from "./LibrarySettings";
import { libraryApi, emptyLibraries, type Libraries } from "./libraries";
import { ProjectsView } from "./ProjectsView";
import { projectApi, type Projects, type ProjectTodo, type ProjectEntry } from "./projects";
import { allFolders, allWorkProject, contextFor, pageTitle, type Page, type ViewContext } from "./navigation";
import { scopeResources, selectedProject } from "./projectScope";
import { useProjectScope } from "./useProjectScope";
import { useRemarkableScope } from "./useRemarkableScope";
import { RemarkableDocument } from "./RemarkableDocument";
import { syncFolder as runFolderSync } from "./remarkableFolderSync";
import { FolderSyncControl } from "./FolderSyncControl";
import { folderSyncTargets } from "./folderSync";
import { ProjectIcon } from "./ProjectIcon";

import { RemarkableView } from "./RemarkableView";

import { DocumentsView, FolderBrowser } from "./DocumentsView";

const MarpViewer = lazy(() => import("./MarpViewer").then((module) => ({ default: module.MarpViewer })));
const session = new DocumentSession(api);
let restore: Promise<boolean> | undefined;
const basename = (path: string) =>
  path
    .split("/")
    .pop()!
    .replace(/\.(md|markdown)$/i, "");

export default function App() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [tab, setTab] = useState<Page>("home");
  const [exporting, setExporting] = useState(false);
  const [pdfHeader, setPdfHeader] = useState<HTMLDivElement | null>(null);
  const documentExport = useRef<AbortController | null>(null);
  const [viewDocument, setViewDocument] = useState(false);
  const [noteDestination, setNoteDestination] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [treeSyncRequest, setTreeSyncRequest] = useState<{ path: string; id: number; trigger: HTMLElement } | null>(null);
  const [recentNotes, setRecentNotes] = useState(false);
  const [assetSelection, setAssetSelection] = useState<{ folder: string; path: string; fragment?: string } | null>(null);
  const [remarkableSelection, setRemarkableSelection] = useState<(ProjectEntry & { page?: number }) | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [assetLoading, setAssetLoading] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [previewLinkError, setPreviewLinkError] = useState("");
  const previewRef = useRef<HTMLElement>(null);
  const [workspaces, setWorkspaces] = useState<Folder[]>([]);
  const [projects, setProjects] = useState<Projects>({ active: null, projects: [] });
  const [projectsReady, setProjectsReady] = useState(false);
  const [startupReady, setStartupReady] = useState(false);
  const [finderReveal, setFinderReveal] = useState<{ folder: string; path: string } | null>(null);
  const [requestedContext, setContext] = useState<ViewContext>("all");
  const selected = selectedProject(projects);
  const projectTabs = useProjectTabs(projects, projectsReady);
  const projectBookmarksRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    projectBookmarksRef.current?.querySelector<HTMLElement>('[aria-label="Selected project"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected?.id, projectTabs.projects.length]);
  const context = contextFor(tab, requestedContext, selected);
  const activeProject = context === "project" ? selected : undefined;
  const roots = allFolders(projects, workspaces, state.folder);
  const allProject = allWorkProject(roots);
  const resourceProject = activeProject ?? allProject;
  const scopeKey = JSON.stringify([projects.library, context, resourceProject.id, resourceProject.folders, resourceProject.remarkableFolders]);
  const title = pageTitle(tab, context);
  const [libraries, setLibraries] = useState<Libraries>(emptyLibraries);
  const [libraryEditing, setLibraryEditing] = useState(false);
  const reloadProjects = async () => {
    const locations = await libraryApi.list();
    setLibraries(locations);
    setProjectsReady(false);
    try {
      const context = await projectApi.load();
      setProjects(context);
      setProjectsReady(true);
      return context;
    } catch (error) {
      setProjects({ active: null, projects: [], library: locations.active });
      throw error;
    }
  };
  const libraryAction = async (action: () => Promise<boolean | void>) => {
    let changed = false;
    const ok = await session.close(async () => {
      if (await action() === false) return;
      await reloadProjects();
      setWorkspaces(await api.workspaces());
      session.clearError();
      changed = true;
    });
    return ok && changed;
  };
  const [pendingProjectFile, setPendingProjectFile] = useState<{ folder: string; path: string; inline?: boolean } | null>(null);
  const saveProjects = async (next: Projects, activate = false) => {
    const ok = await session.close(async () => {
      const saved = await projectApi.save({ ...next, library: projects.library ?? null, revision: projects.revision ?? "" });
      setProjects(saved);
      if (!selectedProject(saved)) setContext("all");
      else if (activate) setContext("project");
      session.clearError();
    });
    if (ok && next.active !== projects.active && next.active) rememberProject(next.active);
    return ok;
  };
  const chooseProjectFolder = async () => {
    let folder: Folder | null = null;
    await session.close(async () => {
      folder = await projectApi.choose();
      setWorkspaces(await api.workspaces());
    });
    return folder;
  };
  const openProjectFile = async (folder: string, path: string, page?: number, inline = false) => {
    if (folder.startsWith("remarkable:")) {
      const entry = remarkableScope.entries.find((entry) => entry.folder === folder && entry.path === path);
      if (!entry || !await session.closeDocument()) return;
      setRemarkableSelection({ ...entry, page }); setAssetSelection(null); setAsset(null);
      if (!inline) setTab("notes"); setViewDocument(true); setFocusDocument(false);
      return;
    }
    if (session.getSnapshot().folder?.path !== folder && !(await session.switchWorkspace(folder))) return;
    setRemarkableSelection(null);
    setWorkspaces(await api.workspaces());
    setPendingProjectFile({ folder, path, inline });
  };
  const createProjectNote = async (folder: string, prefix = "") => {
    if (session.getSnapshot().folder?.path !== folder && !(await session.switchWorkspace(folder))) return;
    setWorkspaces(await api.workspaces());
    setFilename(prefix); setModal("new");
  };
  const addProjectItem = async (folder: string, kind: "task" | "link", text: string, url: string) => {
    if (!text.trim()) throw new Error("Enter a title.");
    if (kind === "link" && !/^https?:\/\//i.test(url)) throw new Error("Use an http or https URL.");
    if (session.getSnapshot().folder?.path !== folder && !(await session.switchWorkspace(folder))) return false;
    let failure: unknown;
    const ok = await session.close(async () => {
      try {
        const label = text.replace(/[\r\n]+/g, " ").replace(/([\\\[\]])/g, "\\$1");
        if (kind === "task") {
          await api.create(folder, `Task-${crypto.randomUUID()}.md`, `- [ ] ${text.replace(/[\r\n]+/g, " ")}\n`);
        } else {
          const line = `- [${label}](<${new URL(url).href.replace(/>/g, "%3E")}>)\n`;
          const listing = await api.list(folder, "");
          const existing = listing.entries.find((entry) => /^links\.(md|markdown)$/i.test(entry.path));
          if (existing) {
            const note = await api.read(folder, existing.path);
            await api.save(folder, { ...note, content: note.content + (note.content.endsWith("\n") ? "" : "\n") + line });
          } else await api.create(folder, "links.md", `# Links\n\n${line}`);
        }
      } catch (error) { failure = error; }
    });
    await session.syncExternal();
    refreshFiles();
    if (failure) throw failure;
    return ok;
  };
  const toggleProjectTask = async (task: ProjectTodo) => {
    if (task.readOnly || task.folder.startsWith("remarkable:")) return false;
    if (session.getSnapshot().folder?.path !== task.folder && !(await session.switchWorkspace(task.folder))) return false;
    let failure: unknown;
    const ok = await session.close(async () => {
      try { await toggleTodo(api, task.folder, task); }
      catch (error) { failure = error; }
    });
    await session.syncExternal();
    projectScope.refresh();
    navigationAll.refresh();
    navigationProject.refresh();
    if (failure) throw failure;
    return ok;
  };
  const browse = (
    folder: string | null = selectedFolder,
    recent = recentNotes,
  ) => {
    void session.close(async () => {
      setSelectedFolder(folder);
      setRecentNotes(recent);
      setViewDocument(false);
      setRemarkableSelection(null);
      setAssetSelection(null);
      setAsset(null);
      setFocusDocument(false);
    });
  };
  const [sidebar, setSidebar] = useState(true);
  const [focusDocument, setFocusDocument] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState("");
  const navigate = (next: Page, nextContext: ViewContext = "all") => {
    if (libraryEditing) return;
    void session.close(async () => {
      setContext(contextFor(next, nextContext, selected));
      setTab(next);
      if (next === "notes") {
        setFocusDocument(false);
        setViewDocument(false);
        setSelectedFolder(null);
        setRecentNotes(false);
      }
      setQuery("");
    });
  };
  const [query, setQuery] = useState("");
  const projectScope = useProjectScope(resourceProject, projects.library ?? null, query, state.note?.revision, !activeProject);
  const navigationAll = useProjectScope(activeProject ? allProject : undefined, projects.library ?? null, "", state.note?.revision, true);
  const navigationProject = useProjectScope(!activeProject ? selected : undefined, projects.library ?? null, "", state.note?.revision);
  const allLocal = activeProject ? navigationAll : projectScope;
  const selectedLocal = activeProject ? projectScope : navigationProject;
  const projectCloud = useRemarkableScope(selected, (!!activeProject && tab === "todos") || tab === "projects");
  const allCloud = useRemarkableScope(undefined, tab === "todos" && !activeProject, true);
  const allCloudIds = new Set(allCloud.entries.map((entry) => entry.remarkableId));
  const cloudReadIds = new Set([...allCloud.readIds, ...projectCloud.readIds]);
  const cloudTasks = [...new Map([...projectCloud.tasks.filter((task) => allCloudIds.has(task.remarkableId) && !allCloud.readIds.includes(task.remarkableId!)), ...allCloud.tasks].map((task) => [`${task.remarkableId}:${task.page}:${task.offset}`, task])).values()];
  const selectedCloudIds = new Set(projectCloud.entries.map((entry) => entry.remarkableId));
  const globalTasks = [...allLocal.tasks, ...cloudTasks].filter((task) => !task.checked).length;
  const selectedTasks = [...selectedLocal.tasks, ...cloudTasks.filter((task) => selectedCloudIds.has(task.remarkableId))].filter((task) => !task.checked).length;
  const globalBadges = {
    projects: { count: projects.projects.filter((project) => !project.archived).length, partial: false },
    notes: { count: allLocal.loading || allCloud.loading ? null : allLocal.inventory.length + allCloud.entries.length, partial: !!allLocal.error || !!allLocal.unavailable.length || !!allCloud.warnings.length },
    todos: { count: allLocal.loading || allCloud.loading ? null : globalTasks, partial: !!allLocal.error || !!allLocal.warnings.length || allCloud.entries.some((entry) => !cloudReadIds.has(entry.remarkableId!)) || !!allCloud.warnings.length },
    remarkable: { count: allCloud.loading ? null : allCloud.entries.length, partial: !!allCloud.warnings.length },
  };
  const projectBadges = {
    notes: { count: selectedLocal.loading || projectCloud.loading ? null : selectedLocal.inventory.length + projectCloud.entries.length, partial: !!selectedLocal.error || !!selectedLocal.unavailable.length || !!projectCloud.warnings.length },
    todos: { count: selectedLocal.loading || projectCloud.loading ? null : selectedTasks, partial: !!selectedLocal.error || !!selectedLocal.warnings.length || projectCloud.entries.some((entry) => !cloudReadIds.has(entry.remarkableId!)) || !!projectCloud.warnings.length },
  };
  const badgeDescription = (value: { count: number | null; partial: boolean } | undefined, label: string) => value
    ? value.count === null ? `${label}: counting…` : `${label}: ${value.count}${value.partial ? (label.toLowerCase().includes("tasks") ? " or more; some sources are unavailable or reMarkable tasks have not been fully read. Open Tasks to read notebook tasks." : " or more; some sources are unavailable.") : ""}`
    : label;
  const badge = (value: { count: number | null; partial: boolean } | undefined) => value && <span className="rail-badge" aria-hidden="true">{value.count === null ? "…" : `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value.count)}${value.partial ? "+" : ""}`}</span>;
  const remarkableScope = activeProject || tab === "projects" ? projectCloud : allCloud;
  const rootLabels = new Map(!activeProject && projects.library ? projects.projects.filter((project) => !project.archived).flatMap((project) => project.folders.filter((folder) => folder.startsWith(`${projects.library}/projects/`) && !folder.slice(`${projects.library}/projects/`.length).includes("/")).map((folder) => [folder, project.name] as const)) : []);
  const homeOwners = (resource: { folder: string; remarkableId?: string }) => projects.projects.filter((project) => !project.archived &&
    (project.folders.includes(resource.folder) || (resource.remarkableId && project.remarkableFolders?.some((link) => allCloud.entries.find((entry) => entry.remarkableId === resource.remarkableId)?.remarkableFolderIds?.includes(link.id)))))
    .map((project) => project.id);
  const scoped = useMemo(() => scopeResources(resourceProject, [...projectScope.inventory, ...remarkableScope.entries], [...projectScope.tasks, ...remarkableScope.tasks], remarkableScope.folders, rootLabels, projectScope.directories),
    [scopeKey, projects.projects, projectScope.inventory, projectScope.directories, projectScope.tasks, remarkableScope.entries, remarkableScope.tasks, remarkableScope.folders]);
  const scopedResults = useMemo(() => scopeResources(resourceProject, [...projectScope.entries, ...remarkableScope.entries.filter((entry) => `${entry.name} ${entry.path} ${entry.folder}`.toLowerCase().includes(query.toLowerCase().trim()))], [], remarkableScope.folders, rootLabels),
    [scopeKey, projects.projects, projectScope.entries, remarkableScope.entries, remarkableScope.folders, query]);
  const fileEntries = scopedResults.entries;
  const inventory = scoped.entries;
  const homeData: HomeData = {
    entries: [...projectScope.inventory, ...allCloud.entries].map((entry) => ({ ...entry, projectIds: homeOwners(entry) })),
    tasks: [...projectScope.tasks, ...allCloud.tasks].map((task) => ({ ...task, projectIds: homeOwners(task) })),
    warnings: [...projectScope.warnings, ...allCloud.warnings],
  };
  const searchHome = async (search: string) => {
    const listings = await Promise.all(roots.map(async (folder) => {
      try { return (await knownFolderApi.list(folder, search)).entries.map((entry) => ({ ...entry, folder, projectIds: projects.projects.filter((project) => !project.archived && project.folders.includes(folder)).map((project) => project.id) })); }
      catch { return []; }
    }));
    return [...new Map(listings.flat().map((entry) => [`${entry.folder.replace(/\\/g, "/").replace(/\/$/, "")}/${entry.path}`, entry])).values()];
  };
  const folderPaths = useMemo(
    () =>
      [
        ...new Set(
          [...(scoped?.folders ?? []), ...inventory.flatMap((entry) => {
            const parts = entry.path.split("/");
            parts.pop();
            return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
          })],
        ),
      ].sort((a, b) => a.localeCompare(b)),
    [inventory, scoped?.folders],
  );
  const selectFolder = (path: string | null, recent = recentNotes) => {
    setSelectedFolder(path);
    setRecentNotes(recent);
    setQuery("");
    setFocusDocument(false);
  };
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState(
    () => localStorage.getItem("notesdive-preview") === "true",
  );
  const [editorMode, setEditorMode] = useState<"visual" | "source">(() =>
    localStorage.getItem("notesdive-editor-mode") === "source"
      ? "source"
      : "visual",
  );
  useEffect(() => {
    localStorage.setItem("notesdive-editor-mode", editorMode);
  }, [editorMode]);
  const [marpEditing, setMarpEditing] = useState(false);
  const [marpSlideEditing, setMarpSlideEditing] = useState(false);
  const [marpIndex, setMarpIndex] = useState(0);
  useEffect(() => { setMarpEditing(false); setMarpSlideEditing(false); setMarpIndex(0); }, [state.folder?.path, state.note?.path]);
  const marp = isMarp(state.text);
  const showPreview = preview && editorMode === "source";
  const [modal, setModal] = useState<"new" | "copy" | "reload" | null>(null);
  const [filename, setFilename] = useState("");
  const [modalError, setModalError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const filenameRef = useRef<HTMLInputElement>(null);
  const dirty = state.text !== state.savedText;
  const html = useMemo(
    () => (showPreview ? renderMarkdown(state.text) : ""),
    [state.text, showPreview],
  );
  useEffect(() => {
    const element = previewRef.current;
    if (!element || !state.folder || !state.note || !showPreview || marp) return;
    return showLocalImages(element, state.folder.path, state.note.path);
  }, [html, state.folder?.path, state.note?.path, showPreview, marp]);
  const wordCount = state.text.trim()
    ? state.text.trim().split(/\s+/u).length
    : 0;

  useEffect(() => {
    restore ??= session.restore();
    void restore.then(async () => {
      if (desktop) {
        try {
          setWorkspaces(await api.workspaces());
          await reloadProjects();
        }
        catch (error) { session.report(error); }
      }
    }).finally(() => setStartupReady(true));
  }, []);
  useEffect(() => {
    if (!desktop || !startupReady) return;
    restore ??= session.restore();
    return watchFinderFiles(session, restore, () => {
      setRemarkableSelection(null);
      setAssetSelection(null);
      setAsset(null);
      setPendingProjectFile(null);
      setContext("all");
      setTab("notes");
      setSelectedFolder(null);
      setQuery("");
      const { folder, note } = session.getSnapshot();
      if (folder && note) {
        rememberDocument(folder.path, note.path);
        setFinderReveal({ folder: folder.path, path: note.path });
      }
      void api.workspaces().then(setWorkspaces).catch((error) => session.report(error));
    });
  }, [startupReady]);
  const chooseWorkspace = async (browse = false) => {
    if (await session.choose()) {
      if (browse) { setContext("all"); setTab("notes"); setViewDocument(false); setSelectedFolder(null); setQuery(""); }
      try { setWorkspaces(await api.workspaces()); }
      catch (error) { session.report(error); }
    }
  };
  const switchWorkspace = async (path: string) => {
    if (path === session.getSnapshot().folder?.path ? await session.close(async () => {}) : await session.switchWorkspace(path)) {
      setContext("all");
      setTab("notes");
      setViewDocument(false);
      setQuery("");
      setSelectedFolder([...scoped.rootFolders].find(([, root]) => root === path)?.[0] ?? null);
      try { setWorkspaces(await api.workspaces()); }
      catch (error) { session.report(error); }
    }
  };
  const forgetWorkspace = async (path: string) => {
    if (await session.forgetWorkspace(path)) {
      try { setWorkspaces(await api.workspaces()); }
      catch (error) { session.report(error); }
    }
  };
  useEffect(() => {
    localStorage.setItem("notesdive-preview", String(preview));
  }, [preview]);
  useEffect(() => {
    if (modal) {
      setModalError("");
      filenameRef.current?.focus();
    }
  }, [modal]);
  useEffect(() => {
    setQuery("");
    setTaskError("");
    setSelectedFolder(null);
    setRecentNotes(false);
    setNoteDestination("");
    setViewDocument(false);
    setRemarkableSelection(null);
    setAssetSelection(null);
    setAsset(null);
    setFocusDocument(false);
  }, [scopeKey]);
  // A Finder open can change the active folder and project context. Reveal it
  // after the scope reset above, rather than letting that reset hide the note.
  useEffect(() => {
    if (!finderReveal || finderReveal.folder !== state.folder?.path || finderReveal.path !== state.note?.path) return;
    setViewDocument(true);
    setFocusDocument(true);
    setFinderReveal(null);
  }, [finderReveal, scopeKey, state.folder?.path, state.note?.path]);
  useEffect(() => {
    if (!assetSelection || assetSelection.folder !== state.folder?.path) return;
    let alive = true;
    setAssetLoading(true);
    setAssetError("");
    void api.readAsset(assetSelection.folder, assetSelection.path)
      .then((next) => { if (alive) setAsset(next); })
      .catch((error) => { if (alive) { setAsset(null); setAssetError(String(error)); } })
      .finally(() => { if (alive) setAssetLoading(false); });
    return () => { alive = false; };
  }, [assetSelection, state.folder?.path, refresh]);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const stops: (() => void)[] = [];
    const register = (p: Promise<() => void>) => {
      void p
        .then((stop) => {
          if (alive) stops.push(stop);
          else stop();
        })
        .catch((e) => session.report(e));
    };
    const refreshFiles = () => {
      setRefresh((v) => v + 1);
      void session.syncExternal();
    };
    register(
      listen<string>("notes-changed", (event) => {
        if (event.payload !== session.getSnapshot().folder?.path) return;
        clearTimeout(timer);
        timer = setTimeout(refreshFiles, 250);
      }),
    );
    register(
      listen<string>("watch-error", (event) =>
        session.report(
          `File watcher: ${event.payload}. Use Refresh to recheck your notes.`,
        ),
      ),
    );
    const close = () => session.close(() => getCurrentWindow().destroy());
    register(
      getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        void close();
      }),
    );
    register(
      listen("request-close", () => {
        void close();
      }),
    );
    window.addEventListener("focus", refreshFiles);
    return () => {
      alive = false;
      clearTimeout(timer);
      stops.forEach((stop) => stop());
      window.removeEventListener("focus", refreshFiles);
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setModal(null);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || libraryEditing) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void session.save();
      }
      if (event.key.toLowerCase() === "p" && event.shiftKey) {
        event.preventDefault();
        setEditorMode("source");
        setPreview((v) => (editorMode === "visual" ? true : !v));
      }
      if (event.key.toLowerCase() === "f" && event.shiftKey) {
        event.preventDefault();
        void session.close(async () => {
          setTab("notes");
          setSidebar(true);
          setFocusDocument(false);
          requestAnimationFrame(() => searchRef.current?.focus());
        });
      }
      if (
        event.key.toLowerCase() === "n" &&
        resourceProject.folders.length &&
        !session.getSnapshot().busy
      ) {
        event.preventDefault();
        newNote();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editorMode, scopeKey, selectedFolder, noteDestination, libraryEditing]);

  const open = (path: string, fragment?: string, inline = tab === "projects") => {
    setRemarkableSelection(null);
    if (fileKind(path) !== "markdown") {
      const folder = session.getSnapshot().folder?.path;
      if (!folder) return;
      void session.closeDocument().then((ok) => {
        if (ok) {
          setAsset(null);
          setAssetSelection({ folder, path, fragment });
          if (!inline) setTab("notes");
          setViewDocument(true);
          rememberDocument(folder, path);
        }
      });
      return;
    }
    void session.open(path).then((ok) => {
      if (ok) {
        setAssetSelection(null);
        setAsset(null);
        if (!inline) setTab("notes");
        setViewDocument(true);
        const folder = session.getSnapshot().folder?.path;
        if (folder) rememberDocument(folder, path);
      }
    });
  };
  useEffect(() => {
    if (!pendingProjectFile || pendingProjectFile.folder !== state.folder?.path) return;
    open(pendingProjectFile.path, undefined, pendingProjectFile.inline);
    setPendingProjectFile(null);
  }, [pendingProjectFile, state.folder?.path]);
  const localRoots = resourceProject.folders;
  const selectedLocalRoot = scoped.rootFolders.get((selectedFolder ?? "").split("/")[0]);
  const defaultDestination = selectedLocalRoot && localRoots.includes(selectedLocalRoot) ? selectedLocalRoot : localRoots.includes(noteDestination) ? noteDestination : activeProject?.defaultFolder ?? (state.folder && localRoots.includes(state.folder.path) ? state.folder.path : localRoots[0]);
  const newNote = () => {
    const [label, ...parts] = (selectedFolder ?? "").split("/");
    const selectedRoot = scoped.rootFolders.get(label);
    const folder = selectedRoot && !selectedRoot.startsWith("remarkable:") ? selectedRoot : defaultDestination;
    if (folder) void createProjectNote(folder, selectedRoot === folder && parts.length ? parts.join("/") + "/" : "").catch((error) => session.report(error));
  };
  const copyNote = () => {
    setFilename(
      state.note
        ? state.note.path.replace(/\.(md|markdown)$/i, " (copy).md")
        : "Untitled.md",
    );
    setModal("copy");
  };
  const refreshFiles = () => {
    navigationAll.refresh();
    navigationProject.refresh();
    projectScope.refresh();
    projectCloud.refresh();
    allCloud.refresh();
    setRefresh((v) => v + 1);
    void session.syncExternal();
  };
  const [trashedDocument, setTrashedDocument] = useState<{ folder: string; token: string } | null>(null);
  const restoreDocument = async () => {
    if (!trashedDocument) return;
    try {
      await invoke("document_action", { folder: trashedDocument.folder, path: trashedDocument.token, action: "restore", name: null });
      setTrashedDocument(null); refreshFiles(); window.dispatchEvent(new Event("document-files-changed"));
    } catch (error) { session.report(error); }
  };
  const documentAction = async (folder: string, path: string, action: DocumentAction, name?: string) => {
    const current = session.getSnapshot();
    const opened = current.folder?.path === folder && (current.note?.path === path || assetSelection?.path === path);
    if (action !== "reveal" && opened && !await session.save()) throw Error("Save the document before continuing.");
    const next = await invoke<string>("document_action", { folder, path, action, name: name ?? null });
    if (action === "trash") setTrashedDocument({ folder, token: next });
    if (action !== "reveal" && opened) {
      await session.closeDocument();
      setAssetSelection(null); setAsset(null);
      if (action === "rename") await openProjectFile(folder, next);
      else setViewDocument(false);
    }
    if (action !== "reveal") {
      refreshFiles();
      window.dispatchEvent(new Event("document-files-changed"));
    }
  };
  const submitModal = async () => {
    if (modal === "reload") {
      if (await session.reload()) setModal(null);
      else setModalError(session.getSnapshot().error);
      return;
    }
    let path = filename.trim();
    if (!path) {
      setModalError("Give your note a name.");
      return;
    }
    if (!/\.(md|markdown)$/i.test(path)) path += ".md";
    if (await session.create(path, modal === "copy")) {
      const folder = session.getSnapshot().folder?.path;
      if (folder) rememberDocument(folder, path);
      setModal(null);
      if (tab !== "projects") setTab("notes");
      setViewDocument(true);
      setRemarkableSelection(null);
      setAssetSelection(null);
      setAsset(null);
      setQuery("");
      setRefresh((v) => v + 1);
      window.dispatchEvent(new Event("document-files-changed"));
      projectScope.refresh();
      navigationAll.refresh();
      navigationProject.refresh();
    } else
      setModalError(
        session.getSnapshot().error || "Resolve your unsaved note first.",
      );
  };

  const openScoped = (path: string, page?: number) => {
    const source = scoped?.sources.get(path);
    if (source) void openProjectFile(source.folder, source.path, page).catch((error) => session.report(error));
  };
  const toggleScoped = async (task: Todo) => {
    if (task.readOnly) return;
    const source = scoped?.sources.get(task.path);
    if (!source || taskBusy) return;
    setTaskBusy(true);
    setTaskError("");
    try { await toggleProjectTask({ ...task, ...source }); }
    catch (error) { setTaskError(String(error)); }
    finally { setTaskBusy(false); }
  };
  const scopedSelectedPath = scoped && state.folder
    ? [...scoped.sources].find(([, source]) => source.folder === state.folder!.path && source.path === (assetSelection?.path || state.note?.path))?.[0]
    : assetSelection?.path || state.note?.path;
  const selectedCloudPath = remarkableSelection
    ? scoped.entries.find((entry) => entry.remarkableId === remarkableSelection.remarkableId)?.path
    : undefined;
  const hasFilesScope = !!activeProject || roots.length > 0 || remarkableScope.entries.length > 0;
  const filesLoading = projectScope.loading || remarkableScope.loading;
  const syncTargets = folderSyncTargets(activeProject, scoped.rootFolders, scoped.entries);
  const syncTarget = selectedFolder ? syncTargets.get(selectedFolder) : undefined;
  const syncFolder = syncTarget?.folder ?? (selectedFolder ? scoped.rootFolders.get(selectedFolder.split("/")[0]) : undefined);
  const syncPath = syncTarget?.path ?? selectedFolder?.split("/").slice(1).join("/") ?? "";
  const syncPaths = new Set(syncTargets.keys());
  const taskListing = {
    tasks: scoped.tasks, warnings: [...projectScope.warnings, ...remarkableScope.warnings],
    files: projectScope.inventory.filter((entry) => fileKind(entry.path) === "markdown").length + remarkableScope.files,
    loading: projectScope.loading, cloudLoading: remarkableScope.loading || remarkableScope.tasksLoading, error: projectScope.error,
  };

  const exportDocument = async () => {
    if (exporting) return;
    const controller = new AbortController();
    documentExport.current = controller;
    setExporting(true);
    try {
      if (assetSelection && asset) {
        const { exportAssetPdf } = await import("./assetPdf");
        await exportAssetPdf(asset, controller.signal);
      } else if (state.note && state.folder) {
        if (marp) {
          const { exportMarpPdf } = await import("./marpPdf");
          await exportMarpPdf({ text: state.text, folder: state.folder.path, notePath: state.note.path, library: projects.library ?? null, signal: controller.signal });
        } else await exportPdf({ title: basename(state.note.path), documentName: state.note.path.split("/").pop(),
          markdown: state.text, folder: state.folder.path, notePath: state.note.path, source: null, signal: controller.signal });
      }
    } catch (error) { if (!controller.signal.aborted) session.report(error); }
    finally { if (documentExport.current === controller) { documentExport.current = null; setExporting(false); } }
  };
  useEffect(() => {
    return () => { documentExport.current?.abort(); };
  }, [state.folder?.path, state.note?.path, assetSelection?.folder, assetSelection?.path, viewDocument]);
  const documentPdfButton = <button className="quiet-button document-pdf-button" aria-label="Export PDF"
    title={marp && !assetSelection ? "Download all slides as PDF, including the presentation theme" : "Download this document as PDF"}
    disabled={exporting || state.busy || assetLoading || !!assetError || (!!assetSelection && !asset)}
    onClick={() => void exportDocument()}>{exporting ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}<span>{exporting ? "Preparing…" : "PDF"}</span></button>;
  const documentVisible = (tab === "notes" || tab === "projects") && viewDocument && (!!remarkableSelection || !!assetSelection || !!state.note);

  const documentReader = (
              <section className="notes-reader" aria-label="Document viewer">
                {viewDocument && remarkableSelection && <>
                  <div className="notes-reader-header">
                    <span className="notes-reader-path">{selectedCloudPath ?? remarkableSelection.path}</span><span className="remarkable-readonly">reMarkable · Read only</span>
                    <div className="document-pdf-slot" ref={setPdfHeader} />
                    <button className="icon-button" aria-label={focusDocument ? "Show notes and folders" : "Focus on document"} onClick={() => { if (tab === "projects") { setTab("notes"); setFocusDocument(true); } else setFocusDocument((value) => !value); }}>{focusDocument ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
                    <button className="icon-button" aria-label="Back to notes" onClick={() => browse()}><X size={16} /></button>
                  </div>
                  <RemarkableDocument key={`${remarkableSelection.remarkableId}:${remarkableSelection.page ?? 1}`} id={remarkableSelection.remarkableId!} name={remarkableSelection.name} page={remarkableSelection.page} exportTarget={pdfHeader} />
                </>}
                {viewDocument && assetSelection && (
                  <>
                    <div className="notes-reader-header">
                      <span className="notes-reader-path" title={assetSelection.path}>{assetSelection.path}</span>
                      <div className="topbar-actions">
                        {documentPdfButton}
                        <button className="quiet-button" onClick={() => setRefresh((value) => value + 1)} disabled={assetLoading}><RefreshCw size={14} /> Refresh file</button>
                        <button className="icon-button" aria-label={focusDocument ? "Show notes and folders" : "Focus on document"} onClick={() => { if (tab === "projects") { setTab("notes"); setFocusDocument(true); } else setFocusDocument((value) => !value); }}>{focusDocument ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
                        <button className="icon-button" aria-label="Back to notes" title="Close document" onClick={() => browse()}><X size={16} /></button>
                      </div>
                    </div>
                    {assetError ? <p className="asset-message" role="alert">{assetError}</p> : asset ? <AssetViewer asset={asset} onOpen={open} fragment={assetSelection.fragment} /> : <p className="asset-message">{assetLoading ? "Loading file…" : "No preview available."}</p>}
                  </>
                )}
                {viewDocument && !remarkableSelection && !assetSelection && state.note && (
                  <>
                    <div className="notes-reader-header">
                      <span
                        className="notes-reader-path"
                        title={state.note.path}
                      >
                        {state.note.path}
                      </span>
                      <div className="topbar-actions">
                        {viewDocument && state.note && (
                          <>
                            {marp ? <div className="editor-mode" role="group" aria-label="Presentation mode">
                              <button aria-pressed={!marpEditing && !marpSlideEditing} onClick={() => { setMarpEditing(false); setMarpSlideEditing(false); }}>Slides</button>
                              <button aria-pressed={marpSlideEditing && !marpEditing} onClick={() => { setMarpEditing(false); setMarpSlideEditing(true); }}>Edit slide</button>
                              <button aria-pressed={marpEditing} onClick={() => setMarpEditing(true)}>Edit Markdown</button>
                            </div> : <div
                              className="editor-mode"
                              role="group"
                              aria-label="Editor mode"
                            >
                              <button
                                aria-pressed={editorMode === "visual"}
                                disabled={state.busy}
                                onClick={() => setEditorMode("visual")}
                              >
                                Visual
                              </button>
                              <button
                                aria-pressed={editorMode === "source"}
                                disabled={state.busy}
                                onClick={() => setEditorMode("source")}
                              >
                                Markdown
                              </button>
                            </div>}
                            <button
                              className={`save-status ${dirty || state.conflict ? "unsaved" : ""}`}
                              onClick={() => void session.save()}
                              disabled={state.busy || state.conflict}
                              aria-label="Save note"
                            >
                              <span aria-live="polite">
                                {state.saving ? (
                                  <LoaderCircle size={13} className="spin" />
                                ) : dirty || state.conflict ? (
                                  <Circle size={10} />
                                ) : (
                                  <Check size={14} />
                                )}
                                {state.saving
                                  ? "Saving…"
                                  : dirty || state.conflict
                                    ? "Unsaved"
                                    : "Saved"}
                              </span>
                            </button>
                            {documentPdfButton}
                            {!marp && <><span className="toolbar-divider" />
                            <button
                              className={`icon-button preview-toggle ${showPreview ? "active" : ""}`}
                              title="Toggle preview · ⌘/Ctrl Shift P"
                              aria-label="Toggle preview"
                              aria-pressed={showPreview}
                              onClick={() => {
                                setEditorMode("source");
                                setPreview((v) =>
                                  editorMode === "visual" ? true : !v,
                                );
                              }}
                            >
                              {showPreview ? (
                                <PanelRightClose size={19} />
                              ) : (
                                <PanelRightOpen size={19} />
                              )}
                            </button></>}
                          </>
                        )}
                        <button
                          className="icon-button"
                          aria-label={
                            focusDocument
                              ? "Show notes and folders"
                              : "Focus on document"
                          }
                          onClick={() => { if (tab === "projects") { setTab("notes"); setFocusDocument(true); } else setFocusDocument((value) => !value); }}
                        >
                          {focusDocument ? (
                            <Minimize2 size={16} />
                          ) : (
                            <Maximize2 size={16} />
                          )}
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Back to notes"
                          title="Close document"
                          disabled={state.busy}
                          onClick={() => browse()}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                    {marp && !marpEditing ? <Suspense fallback={<p className="asset-message" role="status">Loading presentation…</p>}><MarpViewer index={marpIndex} onNavigate={setMarpIndex} editing={marpSlideEditing} onEdit={() => setMarpSlideEditing(true)} disabled={state.busy} onChange={(text) => session.edit(text)} text={state.text} folder={state.folder!.path} notePath={state.note.path} library={projects.library ?? null} /></Suspense> : <div
                      className={`document-panels ${showPreview ? "with-preview" : ""}`}
                    >
                      <section className="editor-panel" aria-label="Editor">
                        {!marp && editorMode === "visual" ? (
                          <RichEditor
                            key={`${state.folder?.path}/${state.note.path}/visual`}
                            text={state.text}
                            folder={state.folder!.path}
                            notePath={state.note.path}
                            disabled={state.busy}
                            onChange={(text) => session.edit(text)}
                            onSource={() => setEditorMode("source")}
                          />
                        ) : (
                          <Editor
                            key={`${state.folder?.path}/${state.note.path}/source`}
                            folder={state.folder!.path}
                            notePath={state.note.path}
                            text={state.text}
                            disabled={state.busy}
                            onChange={(text) => session.edit(text)}
                          />
                        )}
                      </section>
                      {!marp && showPreview && (
                        <section
                          className="preview-panel"
                          aria-label="Markdown preview"
                        >
                          <article
                            ref={previewRef}
                            className="markdown-preview"
                            onClickCapture={(event) => openWebLink(event, setPreviewLinkError)}
                            dangerouslySetInnerHTML={{ __html: html }}
                          />
                          {previewLinkError && <p className="link-error" role="alert">{previewLinkError}</p>}
                        </section>
                      )}
                    </div>}
                    <footer className="document-footer">
                      <span>
                        {wordCount.toLocaleString()} words
                        <span className="footer-dot">·</span>
                        {state.text.length.toLocaleString()} characters
                      </span>
                      <span>
                        UTF-8<span className="footer-dot">·</span>Autosave on
                      </span>
                    </footer>
                  </>
                )}

                {(!viewDocument || (!remarkableSelection && !assetSelection && !state.note)) && (
                  <div className="notes-reader-empty">
                    <FileText size={30} />
                    <h2>A little room to read.</h2>
                    <p>Choose a note or file to view it here.</p>
                  </div>
                )}
              </section>
  );
  return (
    <DocumentActionContext.Provider value={documentAction}><div className="app-shell">
      {trashedDocument && <div className="document-toast" role="status">Document moved to Trash <button onClick={() => void restoreDocument()}>Undo</button><button aria-label="Dismiss notification" onClick={() => setTrashedDocument(null)}>×</button></div>}
      {projectTabs.projects.length > 0 && <div ref={projectBookmarksRef} className="project-bookmarks" role="group" aria-label="Open projects">
        {projectTabs.projects.map((project) => <aside key={project.id}
          className={`project-bookmark project-${project.color}${activeProject?.id === project.id ? "" : " inactive"}`}
          aria-label={selected?.id === project.id ? "Selected project" : `Project tab ${project.name}`} title={project.name}>
          <ProjectIcon icon={project.icon} size={14} />
          <button className="icon-button" aria-label={`Close project ${project.name}`}
            title={`Close project ${project.name}`} disabled={state.busy || taskBusy || libraryEditing}
            onClick={() => void (async () => {
              if (selected?.id === project.id) {
                const remaining = projectTabs.projects.filter((open) => open.id !== project.id);
                if (!await saveProjects({ ...projects, active: remaining.at(-1)?.id ?? null }, !!activeProject)) return;
              }
              projectTabs.close(project.id);
            })()}><X size={13} /></button>
          <button className="project-bookmark-name" aria-label={`Open project ${project.name}`} aria-pressed={activeProject?.id === project.id}
            disabled={state.busy || taskBusy || libraryEditing} onClick={() => {
              if (selected?.id === project.id) navigate(["notes", "todos"].includes(tab) ? tab : "projects", "project");
              else void saveProjects({ ...projects, active: project.id }, true).then((ok) => {
                if (ok && !["notes", "todos"].includes(tab)) setTab("projects");
              });
            }}>{project.name}</button>
        </aside>)}
      </div>}
      <nav className={`navigation-rail${activeProject ? ` project-navigation project-${activeProject.color}` : ""}`} aria-label="Main navigation">
        <div className="rail-logo" title="NotesDive"><img src={brandMark} alt="" width="30" height="30" /></div>
        <button className="rail-button rail-home" title="Home" aria-label="Home"
          aria-current={context === "all" && tab === "home" ? "page" : undefined}
          disabled={state.busy || taskBusy || libraryEditing} onClick={() => navigate("home", "all")}>
          <Home size={20} />
        </button>
        <div className="rail-group rail-all-group" role="group" aria-label="All work">
          {([
            { id: "projects", label: "Projects", Icon: FolderKanban },
            { id: "todos", label: "All tasks", Icon: ListTodo },
            { id: "notes", label: "All files", Icon: FileText },
            { id: "remarkable", label: "reMarkable", Icon: Tablet },
          ] as const).map(({ id, label, Icon }) => (
            <button key={id} className="rail-button" title={badgeDescription(globalBadges[id], label)} aria-label={label}
              aria-description={badgeDescription(globalBadges[id], label)}
              aria-current={context === "all" && tab === id ? "page" : undefined}
              disabled={state.busy || taskBusy || libraryEditing} onClick={() => navigate(id, "all")}><Icon size={20} />{badge(globalBadges[id])}</button>
          ))}
        </div>
        {selected && <div className={`rail-group rail-project-group project-${selected.color}`} role="group" aria-label={`Project: ${selected.name}`}>
          <span className="rail-group-label">PROJECT</span>
          {([
            { id: "projects", label: "Project overview", Icon: FolderKanban },
            { id: "notes", label: "Project files", Icon: FileText },
            { id: "todos", label: "Project tasks", Icon: ListTodo },
          ] as const).map(({ id, label, Icon }) => (
            <button key={id} className="rail-button" title={`${badgeDescription(id === "projects" ? undefined : projectBadges[id], label)} · ${selected.name}`} aria-label={label}
              aria-description={id === "projects" ? undefined : badgeDescription(projectBadges[id], label)}
              aria-current={context === "project" && tab === id ? "page" : undefined}
              disabled={state.busy || taskBusy || libraryEditing} onClick={() => navigate(id, "project")}>{id === "projects" ? <ProjectIcon icon={selected.icon} size={20} /> : <Icon size={20} />}{id !== "projects" && badge(projectBadges[id])}</button>
          ))}
        </div>}
        <button
          className="rail-button rail-settings"
          title={libraryEditing ? "Save or cancel project settings first" : "Settings"}
          aria-label="App settings"
          aria-current={tab === "settings" ? "page" : undefined}
          disabled={state.busy || taskBusy || libraryEditing}
          onClick={() => navigate("settings")}
        >
          <Settings size={20} />
        </button>
      </nav>
      <main className={`main-panel${activeProject ? ` project-workspace project-${activeProject.color}` : ""}`}>
        <header className="topbar">
          {tab === "notes" && (
            <button
              className="icon-button sidebar-toggle"
              aria-label="Toggle files sidebar"
              aria-pressed={sidebar}
              onClick={() => setSidebar((v) => !v)}
            >
              {sidebar ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </button>
          )}
          <div
            className="breadcrumb"
            title={tab === "notes" && viewDocument ? remarkableSelection?.path ?? `${state.folder?.path}/${assetSelection?.path || state.note?.path}` : `${activeProject?.name ?? "All work"} · ${title}`}
          >
            <span className="view-context">{activeProject?.name ?? "All work"}</span>
            <ChevronRight size={13} />
            <strong>{tab === "notes" && viewDocument ? remarkableSelection?.name ?? basename(assetSelection?.path || state.note?.path || title) : title}</strong>
          </div>
          <button className="quiet-button" style={tab === "remarkable" || documentVisible ? { display: "none" } : undefined} disabled={exporting || state.busy || assetLoading}
            title="Generate and save the current page as PDF"
            onClick={async () => {
              setExporting(true);
              try {
                await exportPdf({
                  title: activeProject ? `${activeProject.name} — ${title}` : title,
                  source: document.querySelector<HTMLElement>(tab === "todos" ? "[data-todo-export]" : ".main-panel > .workspace-page"),
                });
              } catch (error) { session.report(error); }
              finally { setExporting(false); }
            }}><Download size={15} />{exporting ? "Preparing…" : "Export PDF"}</button>
          <UpdateNotice />
        </header>
        {state.error && (
          <div
            className={`notice ${state.conflict ? "conflict" : ""}`}
            role="alert"
          >
            <span>{state.error}</span>
            <div>
              {state.note && (
                <>
                  <button onClick={copyNote} disabled={state.busy}>
                    Save a copy
                  </button>
                  {state.conflict ? (
                    <button
                      onClick={() => setModal("reload")}
                      disabled={state.busy}
                    >
                      Reload disk version
                    </button>
                  ) : (
                    <button
                      onClick={() => void session.save()}
                      disabled={state.busy}
                    >
                      Retry save
                    </button>
                  )}
                </>
              )}
              {!state.conflict && (
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => session.clearError()}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={`scope-summary${activeProject ? ` project-${activeProject.color}` : ""}`} role="status" aria-label="Current scope">
          {activeProject ? <><ProjectIcon icon={activeProject.icon} size={14} /><span><strong>{activeProject.name}</strong> · Only linked folders and their subfolders</span>
            {!activeProject.folders.length && !activeProject.remarkableFolders?.length && <button className="quiet-button" onClick={() => navigate("projects", "project")}>Link folders in project settings</button>}</>
            : <><FolderIcon size={14} /><span>{tab === "remarkable" ? "Entire reMarkable library · independent of your selected project" : tab === "projects" ? "All projects in this library · select a project to work within its folders" : tab === "settings" ? "Settings for NotesDive and your connected folders" : "All added local folders and your connected reMarkable library"}</span></>}
        </div>
        {tab === "remarkable" ? <RemarkableView /> : tab === "settings" ? (
          <section className="workspace-page settings-page" aria-label="App settings">
            <div className="page-heading">
              <div>
                <span className="eyebrow">MAKE YOURSELF AT HOME</span>
                <h1>Settings</h1>
                <p>Choose where your projects live.</p>
              </div>
              <button className="quiet-button" disabled={state.busy || taskBusy}
                onClick={() => navigate("projects")}>View projects</button>
            </div>
            <LibrarySettings data={libraries} busy={state.busy || taskBusy || !desktop}
              choose={(name) => libraryAction(() => libraryApi.choose(name))}
              select={(path) => libraryAction(() => libraryApi.switch(path))}
              forget={(path) => libraryAction(() => libraryApi.forget(path))}
              reload={() => libraryAction(async () => {})}
              migrate={() => libraryAction(async () => { await libraryApi.importLegacy(); })} />
            <section className="settings-folders" aria-label="Notes folders">
              <div className="home-section-heading">
                <div><h2>Notes folders</h2><p>Open a folder in All files. Removing a shortcut leaves its files on disk.</p></div>
                <button className="quiet-button" disabled={state.busy || taskBusy || !desktop} onClick={() => void chooseWorkspace()}><FolderOpen size={15} /> Add folder</button>
              </div>
              <div className="settings-folder-list">
                {workspaces.map((saved) => <div className="settings-folder-row" key={saved.path}>
                  <button disabled={state.busy || taskBusy} onClick={() => void switchWorkspace(saved.path)}>
                    <FolderIcon size={16} /><span><strong>{saved.name}</strong><small>{saved.path}</small></span>
                    <b>Open</b>
                  </button>
                  <button className="icon-button" disabled={state.busy || taskBusy} aria-label={`Remove ${saved.name} from NotesDive`} title={`Remove ${saved.name} from NotesDive (files stay on disk)`} onClick={() => void forgetWorkspace(saved.path)}><X size={15} /></button>
                </div>)}
                {!workspaces.length && <p className="home-empty">No extra notes folders added yet.</p>}
              </div>
            </section>
          </section>
        ) : tab === "projects" ? (
          <ProjectsView title={title} overviewOnly={context === "project"} key={projects.library ?? "legacy"} onEditing={setLibraryEditing}
            openSettings={() => navigate("settings")}
            cloud={{ ...projectCloud, refresh: refreshFiles }}
            config={projects} folders={workspaces} busy={state.busy || taskBusy || !desktop || !projectsReady}
            save={saveProjects} choose={chooseProjectFolder}
            selectedResource={viewDocument ? remarkableSelection ? JSON.stringify([remarkableSelection.folder, remarkableSelection.path]) : assetSelection ? JSON.stringify([assetSelection.folder, assetSelection.path]) : state.note ? JSON.stringify([state.folder?.path, state.note.path]) : undefined : undefined}
            reader={viewDocument ? documentReader : undefined}
            open={(folder, path, page) => void openProjectFile(folder, path, page, true).catch((error) => session.report(error))}
            create={(folder) => void createProjectNote(folder).catch((error) => session.report(error))}
            addItem={addProjectItem}
            toggle={toggleProjectTask} />
        ) : tab === "home" ? (
          <HomeView
            key={projects.library ?? "legacy"}
            config={{ ...projects, active: null }}
            cloud={allCloud}
            folder={state.folder}
            folders={workspaces}
            data={homeData}
            loading={projectScope.loading}
            search={searchHome}
            showTasks={() => navigate("todos")}
            busy={state.busy || taskBusy || !desktop}
            selectProject={(id) => {
              if (projects.active === id) { rememberProject(id); navigate("projects", "project"); return; }
              void saveProjects({ ...projects, active: id }, true).then((ok) => {
                if (ok) { rememberProject(id); setTab("projects"); }
              });
            }}
            showProjects={() => navigate("projects")}
            showSettings={() => navigate("settings")}
            chooseFolder={() => void chooseWorkspace(true)}
            showRemarkable={() => navigate("remarkable")}
            open={(folder, path, page) => void openProjectFile(folder, path, page).catch((error) => session.report(error))}
            create={(folder) => void createProjectNote(folder).catch((error) => session.report(error))}
            toggle={toggleProjectTask}
          />
        ) : tab === "todos" ? (
          <TodosView
            key={scopeKey || "no-folder"}
            {...taskListing}
            title={title}
            error={taskError || taskListing.error}
            busy={state.busy || taskBusy}
            refresh={() => {
              setTaskError("");
              refreshFiles();
            }}
            open={openScoped}
            toggle={(task) => void toggleScoped(task)}
            hasFolder={hasFilesScope}
            choose={() => void chooseWorkspace()}
          />
        ) : (
          <section
            className={`workspace-page notes-page ${sidebar ? "" : "folders-hidden"} ${focusDocument && viewDocument ? "reader-focused" : ""}`}
            aria-label="Notes workspace"
          >
            <div className="page-heading">
              <h1>
                {title}{" "}
                <span className="heading-count" title={`${inventory.length} supported files`}>{inventory.length}</span>
              </h1>
              <div className="notes-heading-actions">
                {localRoots.length > 0 && <label className="new-note-destination">New note in <select aria-label="New note folder" value={defaultDestination ?? ""} onChange={(event) => { setNoteDestination(event.target.value); setSelectedFolder([...scoped.rootFolders].find(([, folder]) => folder === event.target.value)?.[0] ?? null); }}>
                  {localRoots.map((folder) => <option key={folder} value={folder}>{[...scoped.rootFolders].find(([, root]) => root === folder)?.[0] ?? folder.split(/[\\/]/).pop()}</option>)}
                </select></label>}
                <button
                  className="quiet-button"
                  aria-label="Refresh files"
                  disabled={!hasFilesScope || state.busy || filesLoading}
                  onClick={refreshFiles}
                >
                  <RefreshCw size={15} className={filesLoading ? "spin" : ""} />
                  Refresh
                </button>
                <button
                  className="quiet-button"
                  aria-label="New note"
                  disabled={state.busy || !localRoots.length}
                  onClick={newNote}
                >
                  <FilePlus2 size={15} />
                  New note
                </button>
              </div>
            </div>
            <div className="todo-controls">
              <div className="notes-filter-controls">
                <div
                  className="task-filters"
                  role="group"
                  aria-label="Files filter"
                >
                  <button
                    aria-pressed={!recentNotes}
                    onClick={() => {
                      setRecentNotes(false);
                      setFocusDocument(false);
                    }}
                  >
                    All
                  </button>
                  <button
                    aria-label="Recently changed"
                    aria-pressed={recentNotes}
                    onClick={() => {
                      setRecentNotes(true);
                      setFocusDocument(false);
                    }}
                  >
                    Recent
                  </button>
                </div>
                <select
                  className="notes-folder-select"
                  aria-label="Choose notes folder"
                  value={selectedFolder || ""}
                  onChange={(event) => selectFolder(event.target.value || null)}
                >
                  <option value="">All folders</option>
                  {folderPaths.filter((path) => !path.includes("/") || path === selectedFolder).map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </div>
              <label className="task-search">
                <Search size={15} />
                <input
                  ref={searchRef}
                  aria-label="Search files"
                  placeholder="Search names or content"
                  value={query}
                  disabled={!hasFilesScope}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedFolder(null);
                    setRecentNotes(false);
                    setFocusDocument(false);
                  }}
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
            </div>
            <div className="notes-browser">
              <aside className="notes-folder-panel" aria-label="Notes sidebar">
                <FolderBrowser
                  key={`${scopeKey}:${sidebar}:${focusDocument && !!viewDocument}`}
                  entries={inventory}
                  roots={scoped?.folders}
                  directories={scoped.directories}
                  syncPaths={syncPaths}
                  openSync={(path, trigger) => {
                    selectFolder(path, false);
                    setTreeSyncRequest(previous => ({ path, trigger, id: (previous?.id ?? 0) + 1 }));
                  }}
                  selected={selectedFolder}
                  recent={recentNotes}
                  busy={false}
                  select={selectFolder}
                />
              </aside>
              <DocumentsView
                key={scopeKey}
                source={(path) => scoped.sources.get(path)}
                entries={fileEntries}
                selected={selectedFolder}
                recent={recentNotes}
                query={query}
                selectedPath={viewDocument ? selectedCloudPath ?? scopedSelectedPath : undefined}
                busy={state.busy || !desktop}
                loading={filesLoading}
                error={projectScope.error}
                warnings={[...projectScope.warnings, ...remarkableScope.warnings]}
                hasFolder={hasFilesScope}
                open={openScoped}
                choose={() => void chooseWorkspace()}
                syncControl={activeProject && selectedFolder && syncFolder && activeProject.folders.includes(syncFolder)
                  && !syncFolder.startsWith("notesdive-external:") && !query && !recentNotes ? <FolderSyncControl
                    key={`${activeProject.id}:${syncFolder}:${syncPath}`} project={activeProject} folder={syncFolder}
                    path={syncPath} label={syncTarget?.label ?? selectedFolder} disabled={state.busy || !desktop}
                    openRequest={treeSyncRequest?.path === selectedFolder ? treeSyncRequest : undefined}
                    onOpenRequestHandled={() => setTreeSyncRequest(null)}
                    run={async (link) => {
                      let result: Awaited<ReturnType<typeof runFolderSync>> | undefined;
                      const ok = await session.close(async () => {
                        try {
                          result = await runFolderSync(activeProject.id, link.id, projects.library ?? null);
                          setProjects(result.context);
                          setRefresh(value => value + 1);
                          window.dispatchEvent(new Event("notesdive-remarkable-changed"));
                        } finally { await reloadProjects(); }
                      });
                      if (!ok || !result) throw new Error(session.getSnapshot().error || "Save or close your open note before synchronising.");
                      return result;
                    }}
                    save={async (link) => {
                      const remarkableSync = [...(activeProject.remarkableSync ?? []).filter((current) => current.id !== link.id), link];
                      const ok = await saveProjects({ ...projects, projects: projects.projects.map((project) =>
                        project.id === activeProject.id ? { ...project, remarkableSync } : project) });
                      if (!ok) throw new Error(session.getSnapshot().error || "Could not save sync setup. Resolve the open note first.");
                    }} /> : undefined}
              />
              {documentReader}
            </div>
          </section>
        )}
      </main>

      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !state.busy) setModal(null);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              void submitModal();
            }}
            onKeyDown={(e) => {
              if (e.key !== "Tab") return;
              const controls = [
                ...e.currentTarget.querySelectorAll<HTMLElement>(
                  "input, button:not(:disabled)",
                ),
              ];
              const first = controls[0],
                last = controls[controls.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="modal-icon">
              <FilePlus2 size={23} />
            </div>
            <h2 id="modal-title">
              {modal === "reload"
                ? "Reload from disk?"
                : modal === "copy"
                  ? "Keep your draft as a copy"
                  : "A new place to begin"}
            </h2>
            <p>
              {modal === "reload"
                ? "This replaces the text in your editor with the current file on disk. Save a copy first if you want to keep your draft."
                : "Give your Markdown note a name. You can include an existing subfolder, like Ideas/First thought.md."}
            </p>
            {modal !== "reload" && (
              <>
                <label htmlFor="filename">Note name</label>
                <input
                  id="filename"
                  ref={filenameRef}
                  autoFocus
                  value={filename}
                  disabled={state.busy}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="Untitled.md"
                  autoComplete="off"
                />
              </>
            )}
            {modalError && (
              <p className="modal-error" role="alert">
                {modalError}
              </p>
            )}
            <div className="modal-actions">
              <button
                autoFocus={modal === "reload"}
                type="button"
                disabled={state.busy}
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={state.busy}
                type="submit"
              >
                {state.busy
                  ? "Working…"
                  : modal === "reload"
                    ? "Reload disk version"
                    : modal === "copy"
                      ? "Save copy"
                      : "Create note"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div></DocumentActionContext.Provider>
  );
}
