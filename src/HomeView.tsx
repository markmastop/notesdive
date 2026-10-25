import { DocumentActions } from "./DocumentActions";
import { DocumentIcon } from "./DocumentIcon";
import { ProjectIcon } from "./ProjectIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CircleAlert,
  ListTodo,
  Plus,
  Radio,
  FilePlus2,
  FolderOpen,
  Search,
  Settings2,
  Tablet,
} from "lucide-react";
import type { RemarkableScopeData } from "./useRemarkableScope";
import { remarkableApi } from "./remarkable";
import { desktop, type Folder } from "./api";
import { folderName, type ProjectTodo, type Projects } from "./projects";
import { selectedProject } from "./projectScope";
import { localToday } from "./todos";
import { focusTasks, needsAttention, readStreams, saveStreams, streamData, type Attention, type Stream } from "./cockpit";
import { TodoMetadata } from "./TodoMetadata";
import {
  orderedProjects,
  type HomeData,
  type HomeEntry,
} from "./home";

export function HomeView({
  config,
  cloud,
  folder,
  folders,
  data,
  loading,
  search,
  showTasks,
  busy,
  selectProject,
  showProjects,
  showSettings,
  chooseFolder,
  showRemarkable,
  open,
  create,
  toggle,
}: {
  config: Projects;
  cloud: RemarkableScopeData;
  folder: Folder | null;
  folders: Folder[];
  data: HomeData;
  loading: boolean;
  search: (query: string) => Promise<HomeEntry[]>;
  showTasks: () => void;
  busy: boolean;
  selectProject: (id: string) => void;
  showProjects: () => void;
  showSettings: () => void;
  chooseFolder: () => void;
  showRemarkable: () => void;
  open: (folder: string, path: string, page?: number) => void;
  create: (folder: string) => void;
  toggle: (task: ProjectTodo) => Promise<boolean>;
}) {
  const projects = orderedProjects(config);
  const scope = selectedProject(config);
  const activeProjects = scope ? [scope] : projects;
  const projectsKey = JSON.stringify(
    activeProjects.map((project) => [project.id, project.folders]),
  );
  const searchRef = useRef(search);
  searchRef.current = search;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const update = () => setRefresh((value) => value + 1);
    window.addEventListener("document-files-changed", update);
    return () => window.removeEventListener("document-files-changed", update);
  }, []);

  const [query, setQuery] = useState("");
  const [searchEntries, setSearchEntries] = useState<HomeEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [taskLimit, setTaskLimit] = useState(5);
  const [documentLimit, setDocumentLimit] = useState(5);
  const [destination, setDestination] = useState("");
  const [remarkableConnected, setRemarkableConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    if (desktop) void remarkableApi.status()
      .then((connected) => { if (alive) setRemarkableConnected(connected); })
      .catch(() => { if (alive) setRemarkableConnected(false); });
    return () => { alive = false; };
  }, [refresh]);
  const library = config.library ?? null;
  const [clock, setClock] = useState(() => new Date());
  const [attention, setAttention] = useState<Attention | null>(null);
  const [streamId, setStreamId] = useState("recent");
  const [streamLimit, setStreamLimit] = useState(8);
  const [streamKind, setStreamKind] = useState<"all" | "documents" | "tasks">("all");
  const [streams, setStreams] = useState<Stream[]>(() => readStreams(library));
  const [streamEditor, setStreamEditor] = useState(false);
  const [streamName, setStreamName] = useState("");
  const [streamProject, setStreamProject] = useState("");
  const [streamTag, setStreamTag] = useState("");
  const [streamValidation, setStreamValidation] = useState("");
  useEffect(() => {
    setStreams(readStreams(library));
    setStreamId("recent");
    setStreamKind("all");
    setStreamEditor(false);
    setStreamName(""); setStreamProject(""); setStreamTag(""); setStreamValidation("");
    setAttention(null);
  }, [library]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const update = () => {
      if (!document.hidden) setRefresh((n) => n + 1);
    };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  useEffect(() => {
    const search = query.trim();
    if (!search) {
      setSearchEntries(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearchEntries(null);
    setSearching(true);
    const timer = setTimeout(() => {
      void searchRef.current(search)
        .then((entries) => { if (!controller.signal.aborted) setSearchEntries(entries); })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(String(reason));
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, library, projectsKey, folder?.path]);
  useEffect(() => {
    setTaskLimit(5);
    setDocumentLimit(5);
  }, [query]);
  const combined = useMemo(() => data, [data]);
  const term = query.toLowerCase().trim();
  const projectName = (ids: string[], source: string) =>
    ids
      .map((id) => config.projects.find((project) => project.id === id)?.name)
      .find(Boolean) || folderName(source);
  const sourceName = (ids: string[], source: string) =>
    config.library &&
    ids.some((id) => config.projects.find((project) => project.id === id)?.folders.includes(source)) && source.startsWith(`${config.library}/projects/`) && !source.slice(`${config.library}/projects/`.length).includes("/")
      ? "Project folder"
      : folderName(source);
  const sourceLabel = (ids: string[], source: string, path: string) =>
    ids.length
      ? `${projectName(ids, source)} · ${sourceName(ids, source)} / ${path}`
      : `${sourceName(ids, source)} · ${path}`;
  const projectMatches = projects.filter((project) =>
    `${project.name} ${project.description}`.toLowerCase().includes(term),
  );
  const docs = term
    ? [...(searchEntries ?? combined.entries.filter((entry) => !entry.remarkableId && `${entry.name} ${entry.path}`.toLowerCase().includes(term))),
      ...cloud.entries.filter((entry) => `${entry.name} ${entry.path} ${folderName(entry.folder)}`.toLowerCase().includes(term)).map((entry) => ({ ...entry, projectIds: scope ? [scope.id] : [] }))]
    : [...combined.entries].sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  const openTasks = focusTasks(combined.tasks.filter(
    (task) =>
      !task.checked &&
      `${task.text} ${task.path} ${task.projectIds.map((id) => config.projects.find((project) => project.id === id)?.name ?? "").join(" ")}`
        .toLowerCase()
        .includes(term),
  ), localToday(clock));
  const destinations = activeProjects.flatMap((project) => {
    const path = project.defaultFolder ?? project.folders[0];
    return path
      ? [{ key: `project:${project.id}`, label: project.name, folder: path }]
      : [];
  });
  for (const source of folders) if (!destinations.some((item) => item.folder === source.path))
    destinations.push({ key: `folder:${source.path}`, label: source.name, folder: source.path });
  useEffect(() => {
    if (!destinations.some((item) => item.key === destination))
      setDestination(
        destinations.find((item) => item.key === `project:${config.active}`)
          ?.key ??
          destinations[0]?.key ??
          "",
      );
  }, [config.active, projectsKey, folder?.path, destination]);
  const selected = destinations.find((item) => item.key === destination);
  const createNote = () => {
    if (selected) create(selected.folder);
  };
  const complete = async (task: ProjectTodo) => {
    if (task.readOnly) return;
    if (working || busy) return;
    setWorking(true);
    setError("");
    try {
      if (await toggle(task)) setRefresh((n) => n + 1);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWorking(false);
    }
  };
  const visibleTasks = attention ? openTasks.filter((task) => needsAttention(task, attention, localToday(clock))) : openTasks;
  const streamChoices = [
    { id: "recent", name: "Recent work" },
    { id: "week", name: "This week" },
    ...activeProjects.slice(0, 3).map((project) => ({ id: `project:${project.id}`, name: project.name })),
    ...streams.filter((stream) => !stream.projectId || activeProjects.some((project) => project.id === stream.projectId)),
  ];
  const selectedStreamId = streamChoices.some((choice) => choice.id === streamId) ? streamId : "recent";
  const customStream = streams.find((stream) => stream.id === selectedStreamId);
  const streamProjectId = customStream?.projectId || (selectedStreamId.startsWith("project:") ? selectedStreamId.slice(8) : undefined);
  const feed = streamData({ ...combined, tasks: openTasks, entries: docs }, {
    projectId: streamProjectId, tag: customStream?.tag, week: selectedStreamId === "week",
  }, clock);
  const taskRows = feed.tasks.map((task) => ({ kind: "task" as const, task, key: `task:${JSON.stringify([task.folder, task.path, task.offset])}` }));
  const documentRows = feed.entries.map((entry) => ({ kind: "document" as const, entry, key: `doc:${JSON.stringify([entry.folder, entry.path])}` }));
  const feedRows = Array.from({ length: Math.max(taskRows.length, documentRows.length) }, (_, index) => [taskRows[index], documentRows[index]])
    .flat().filter((row) => row !== undefined)
    .filter((row) => streamKind === "all" || (streamKind === "tasks" ? row.kind === "task" : row.kind === "document"));
  const streamDescription = selectedStreamId === "week" ? "Actions scheduled this week and documents changed this week."
    : customStream?.tag ? `Open actions tagged #${customStream.tag}${streamProjectId ? " in this project" : " across projects"}.`
      : "Open actions and recently changed documents.";
  const updateStreams = (next: Stream[]) => {
    try { saveStreams(library, next); setStreams(next); return true; }
    catch { setError("Streams could not be saved on this device. Please try again."); return false; }
  };
  const addStream = (event: React.FormEvent) => {
    event.preventDefault();
    const name = streamName.trim();
    const tag = streamTag.trim().replace(/^#/, "");
    if (!name || streams.length >= 30) return;
    if (tag && !/^[\p{L}\p{N}_-]+$/u.test(tag)) {
      setStreamValidation("Use one tag with letters, numbers, dashes or underscores."); return;
    }
    setStreamValidation("");
    const stream = { id: `saved:${crypto.randomUUID()}`, name, projectId: streamProject, tag };
    if (updateStreams([...streams, stream])) {
      setStreamId(stream.id); setStreamLimit(8); setStreamEditor(false); setStreamName(""); setStreamProject(""); setStreamTag("");
    }
  };
  const renderTask = (task: typeof openTasks[number]) => <div className="dashboard-task" key={JSON.stringify([task.folder, task.path, task.offset])}>
    <input type="checkbox" aria-label={`Complete ${task.text}`} checked={false} disabled={busy || working || task.readOnly} onChange={() => void complete(task)} />
    <button disabled={busy} onClick={() => open(task.folder, task.path, task.page)}>
      <strong>{task.text}</strong><TodoMetadata task={task} /><small>{sourceLabel(task.projectIds, task.folder, task.path)}{task.readOnly && " · Read only"}</small>
    </button>
  </div>;
  const renderDocument = (entry: HomeEntry, showDate = false) => <DocumentActions key={JSON.stringify([entry.folder, entry.path])} folder={entry.remarkableId ? undefined : entry.folder} path={entry.path} disabled={busy}><button disabled={busy}
    onClick={() => open(entry.folder, entry.path)} title={`${entry.folder} / ${entry.path}`}>
    <DocumentIcon path={entry.path} remarkable={!!entry.remarkableId} /><span><strong>{entry.name.replace(/\.(md|markdown)$/i, "")}</strong><small>{sourceLabel(entry.projectIds, entry.folder, entry.path)}</small></span>
    {showDate && entry.modified > 0 && <time dateTime={new Date(entry.modified).toISOString()}>{new Date(entry.modified).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</time>}<ArrowUpRight size={14} />
  </button></DocumentActions>;
  return (
    <section className="workspace-page home-page" aria-label="Home">
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">NOTESDIVE</span>
          <h1>Home</h1>
          <p>{scope ? `${scope.name}: your work, in view.` : "Your work, in view. What needs attention and where to continue."}</p>
        </div>
        <div className="home-folder-actions">
          <button className="quiet-button" onClick={chooseFolder} disabled={busy || !desktop}>
            <FolderOpen size={15} /> Open folder
          </button>
          <button className="quiet-button" onClick={showSettings}>
            <Settings2 size={15} /> Manage folders
          </button>
        </div>
      </div>
      <div className="dashboard-toolbar">
        <label className="dashboard-search">
          <Search size={16} />
          <input
            aria-label="Search Home"
            placeholder="Find documents, tasks and projects…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="dashboard-destination">
          New note in{" "}
          <select
            aria-label="New note project"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            disabled={!destinations.length || busy}
          >
            {!destinations.length && <option value="">Choose a project</option>}
            {destinations.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="dashboard-create"
          onClick={createNote}
          disabled={!selected || busy}
        >
          <FilePlus2 size={15} /> New note
        </button>
      </div>
      {(error || combined.warnings.length > 0) && (
        <details className="project-warnings">
          <summary>
            {error
              ? "Home needs attention"
              : `${combined.warnings.length} files or folders could not be checked`}
          </summary>
          {error && <p>{error}</p>}
          {combined.warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </details>
      )}
      <div className="cockpit-context">
        <span>{scope?.name ?? "All projects"}</span>
        <time dateTime={localToday(clock)}>{clock.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</time>
      </div>
      <section className={`cockpit-attention${attention ? " has-selection" : ""}`} aria-label="Needs attention">
        <CircleAlert size={17} /> <strong>Needs attention</strong>
        {(["overdue", "today", "blocked"] as const).map((kind) => {
          const count = combined.tasks.filter((task) => needsAttention(task, kind, localToday(clock))).length;
          const label = kind === "overdue" ? "overdue" : kind === "today" ? "due today" : "blocked";
          return <button key={kind} aria-pressed={attention === kind} disabled={!count || busy}
            onClick={() => { setAttention(attention === kind ? null : kind); setQuery(""); setTaskLimit(5); }}>
            <span>{count}</span> {label}
          </button>;
        })}
        {(loading || cloud.tasksLoading) && <small role="status">Checking tasks…</small>}
      </section>
      <div className="cockpit-layout">
          <section className="dashboard-panel cockpit-streams" aria-label="Streams">
            <div className="dashboard-panel-heading">
              <div><span className="dashboard-kicker">ACROSS YOUR WORK</span><h2>Streams</h2></div>
              <button className="dashboard-heading-action" aria-expanded={streamEditor} onClick={() => setStreamEditor(!streamEditor)}><Plus size={14} /> Add stream</button>
            </div>
            <div className="cockpit-stream-tabs" aria-label="Choose a stream">
              {streamChoices.map((choice) => <button key={choice.id} aria-pressed={selectedStreamId === choice.id}
                onClick={() => { setStreamId(choice.id); setStreamLimit(8); }}><Radio size={13} />{choice.name}</button>)}
            </div>
            <div className="cockpit-kind-filter" aria-label="Stream item type">
              {(["all", "documents", "tasks"] as const).map((kind) => <button key={kind} aria-pressed={streamKind === kind}
                onClick={() => { setStreamKind(kind); setStreamLimit(8); }}>{kind === "all" ? "All" : kind === "documents" ? "Documents" : "Actions"}</button>)}
            </div>
            <div className="cockpit-column-scroll" aria-label="Stream contents" tabIndex={0}>
            {streamEditor && <form className="cockpit-stream-editor" onSubmit={addStream}>
              <label>Name<input aria-label="Stream name" value={streamName} maxLength={60} onChange={(event) => setStreamName(event.target.value)} required placeholder="e.g. Decisions" /></label>
              <label>Project<select aria-label="Stream project" value={streamProject} onChange={(event) => setStreamProject(event.target.value)}><option value="">All projects</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label>Task tag (optional)<input aria-label="Stream task tag" value={streamTag} maxLength={60} onChange={(event) => setStreamTag(event.target.value)} placeholder="#decisions" /></label>
              <p>A project stream includes documents and actions. A tag stream shows matching actions.</p>
              {streamValidation && <p role="alert">{streamValidation}</p>}
              <div><button className="dashboard-create" type="submit" disabled={streams.length >= 30}>Save stream</button><button type="button" className="quiet-button" onClick={() => setStreamEditor(false)}>Cancel</button></div>
            </form>}
            <div className="cockpit-stream-description"><span>{streamDescription}</span>{customStream && <button className="dashboard-heading-action" onClick={() => updateStreams(streams.filter((stream) => stream.id !== customStream.id))}>Remove stream</button>}</div>
            <div className="cockpit-feed">
              {feedRows.slice(0, streamLimit).map((row) => row.kind === "task"
                ? <div className="cockpit-feed-task" key={row.key}><div className="cockpit-feed-label"><ListTodo size={14} /><span>Action · {projectName(row.task.projectIds, row.task.folder)}</span></div>{renderTask(row.task)}</div>
                : <div className="cockpit-feed-document" key={row.key}><div className="cockpit-feed-label"><DocumentIcon path={row.entry.path} remarkable={!!row.entry.remarkableId} /><span>{/\.(md|markdown)$/i.test(row.entry.path) ? "Note" : "Document"} · {projectName(row.entry.projectIds, row.entry.folder)}</span></div><div className="dashboard-list">{renderDocument(row.entry, true)}</div></div>)}
            </div>
            {!feedRows.length && <p className="home-empty">{loading || searching ? "Checking your work…" : "No work matches this stream."}</p>}
            {feedRows.length > streamLimit && <button className="dashboard-more" onClick={() => setStreamLimit((limit) => limit + 20)}>Show more in this stream <ArrowUpRight size={14} /></button>}
            </div>
          </section>
          <section className="dashboard-panel dashboard-tasks" aria-label="Open project tasks">
            <div className="dashboard-panel-heading">
              <div><span className="dashboard-kicker">NEXT STEPS</span><h2>{attention ? attention === "overdue" ? "Overdue actions" : attention === "today" ? "Due today" : "Blocked actions" : "My focus"}
                <span className="heading-count">{visibleTasks.length}</span></h2></div>
              <button className="dashboard-heading-action" onClick={showTasks}>View all tasks <ArrowUpRight size={13} /></button>
            </div>
            <div className="cockpit-column-scroll" aria-label="Focus contents" tabIndex={0}>
            <div className="dashboard-task-list">{visibleTasks.slice(0, taskLimit).map(renderTask)}</div>
            {!loading && !visibleTasks.length && <p className="home-empty">{term ? "No tasks match your search." : attention ? "No actions need this attention." : "No open tasks right now."}</p>}
            {visibleTasks.length > taskLimit && <button className="dashboard-more" onClick={() => setTaskLimit((limit) => limit + 20)}>Show more tasks <ArrowUpRight size={14} /></button>}
            {remarkableConnected && <p className="cockpit-cloud-note">Includes reMarkable tasks already read. All tasks reads the entire cloud library.</p>}
            </div>
          </section>
        <aside className="cockpit-sidebar" aria-label="Continue working column" tabIndex={0}>
          <section className="dashboard-panel dashboard-documents" aria-label="Continue working">
            <div className="dashboard-panel-heading"><div><span className="dashboard-kicker">YOUR WORK</span><h2>{term ? "Matching documents" : "Recently changed"}</h2></div>{(loading || searching || cloud.loading) && <small role="status">Checking…</small>}</div>
            <div className="dashboard-list">{docs.slice(0, documentLimit).map((entry) => renderDocument(entry))}</div>
            {!loading && !searching && !docs.length && <p className="home-empty">{term ? "No documents match your search." : "Open or create a note to start working."}</p>}
            {docs.length > documentLimit && <button className="dashboard-more" onClick={() => setDocumentLimit((limit) => limit + 20)}>Show more documents <ArrowUpRight size={14} /></button>}
          </section>
          <section className="dashboard-panel dashboard-projects" aria-label="My projects">
            <div className="dashboard-panel-heading"><div><span className="dashboard-kicker">TOGETHER</span><h2>My projects</h2></div><button className="dashboard-heading-action" onClick={showProjects}>View all <ArrowUpRight size={13} /></button></div>
            <div className="dashboard-project-list">{projectMatches.slice(0, term ? 20 : 6).map((project) => <button key={project.id} disabled={busy} onClick={() => selectProject(project.id)} aria-current={project.id === scope?.id ? "true" : undefined} className={`dashboard-project project-${project.color}`}>
              <ProjectIcon icon={project.icon} size={17} /><span><strong>{project.name}</strong><small>{project.description || `${project.folders.length + (project.remarkableFolders?.length ?? 0)} linked folders`}</small></span>
              {(!scope || scope.id === project.id) && <b>{combined.tasks.filter((task) => !task.checked && task.projectIds.includes(project.id)).length}</b>}
            </button>)}</div>
            {!projectMatches.length && <p className="home-empty">{term ? "No projects match your search." : "Create a project to bring related work together."}</p>}
            {!projects.length && !term && <button className="dashboard-more" onClick={showProjects}>Open Projects <ArrowUpRight size={14} /></button>}
          </section>
          {remarkableConnected && <section className="dashboard-panel dashboard-remarkable" aria-label="reMarkable Cloud">
            <div className="dashboard-panel-heading"><div><span className="dashboard-kicker">YOUR TABLET</span><h2>reMarkable <span className="heading-count">Connected</span></h2></div></div>
            <button className="cockpit-tablet-link" disabled={busy} onClick={showRemarkable}><Tablet size={17} /><span>{scope ? "Open linked reMarkable folders" : "Open your reMarkable library"}</span><ArrowUpRight size={14} /></button>
          </section>}
        </aside>
      </div>
      <p className="local-footnote">
        {scope?.remarkableFolders?.length ? "Local files stay in your folders. reMarkable documents stay in reMarkable Cloud." : "On your device. Your notes stay in your folders."}
      </p>
    </section>
  );
}
