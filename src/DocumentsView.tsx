import { DocumentActions } from "./DocumentActions";
import { DocumentIcon } from "./DocumentIcon";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  RefreshCw,
} from "lucide-react";
import type { Entry } from "./api";
import { fileKind } from "./fileTypes";

export function FolderBrowser({
  entries,
  selected,
  recent,
  busy,
  select,
  roots,
  directories,
  syncPaths,
  openSync,
  expandedFolders,
  onExpandedFolders,
}: {
  entries: Entry[];
  selected: string | null;
  recent: boolean;
  busy: boolean;
  select: (path: string | null, recent?: boolean) => void;
  expandedFolders?: Set<string>;
  onExpandedFolders?: (folders: Set<string>) => void;
  roots?: string[];
  directories?: string[];
  syncPaths?: Set<string>;
  openSync?: (path: string, trigger: HTMLElement) => void;
}) {
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(new Set());
  const expanded = expandedFolders ?? localExpanded;
  const setExpanded = (update: (previous: Set<string>) => Set<string>) => {
    const next = update(expanded);
    if (onExpandedFolders) onExpandedFolders(next);
    else setLocalExpanded(next);
  };
  const folders = useMemo(() => {
    const map = new Map<string, number>((roots ?? []).map((path) => [path, 0]));
    for (const directory of directories ?? []) {
      const parts = directory.split("/");
      parts.forEach((_, index) => map.set(parts.slice(0, index + 1).join("/"), 0));
    }
    for (const entry of entries) {
      const parts = entry.path.split("/");
      parts.pop();
      parts.forEach((_, i) => {
        const path = parts.slice(0, i + 1).join("/");
        map.set(path, (map.get(path) ?? 0) + (i === parts.length - 1 ? 1 : 0));
      });
    }
    return [...map].sort(([a], [b]) => a.localeCompare(b));
  }, [entries, roots, directories]);
  return (
    <nav className="document-folders" aria-label="File folders">
      <button
        className="folder-choice"
        aria-current={!selected ? "page" : undefined}
        disabled={busy}
        onClick={() => select(null, recent)}
      >
        <FileText size={15} />
        <span>All folders</span>
        <b>{entries.length}</b>
      </button>
      <div className="task-documents-label">FOLDERS</div>
      {folders
        .filter(
          ([path]) =>
            path.split("/").slice(0, -1).every((_, index, parts) =>
              expanded.has(parts.slice(0, index + 1).join("/")),
            ),
        )
        .map(([path, count]) => {
          const nested = folders.some(([child]) =>
            child.startsWith(path + "/"),
          );
          return (
            <div
              className="folder-choice-row"
              key={path}
              style={{
                paddingLeft: Math.min(path.split("/").length - 1, 5) * 12,
              }}
            >
              {nested ? (
                <button
                  className="folder-disclosure"
                  aria-label={`Toggle folder ${path}`}
                  aria-expanded={expanded.has(path)}
                  onClick={() =>
                    setExpanded((old) => {
                      const next = new Set(old);
                      if (next.has(path)) next.delete(path);
                      else next.add(path);
                      return next;
                    })
                  }
                >
                  {!expanded.has(path) ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>
              ) : (
                <span className="folder-disclosure" />
              )}
              <button
                className={`folder-choice${syncPaths?.has(path) ? " has-sync" : ""}`}
                title={path}
                aria-label={`Folder ${path}`}
                aria-current={selected === path ? "page" : undefined}
                disabled={busy}
                onClick={() => {
                  if (nested && !expanded.has(path)) {
                    setExpanded((old) => new Set(old).add(path));
                  }
                  select(path);
                }}
              >
                <Folder size={14} />
                <span>{path.split("/").pop()}</span>
                {syncPaths?.has(path) && <span className="folder-sync-slot" aria-hidden="true" />}
                <b>{count}</b>
              </button>
              {syncPaths?.has(path) && <button type="button" className="folder-tree-sync"
                aria-label={`Open sync for ${path}`} title="Open sync · Sync now"
                disabled={busy || !openSync} onClick={(event) => openSync?.(path, event.currentTarget)}>
                <RefreshCw size={12} className="folder-sync-indicator" aria-label="Sync setup saved" />
              </button>}
            </div>
          );
        })}
    </nav>
  );
}

export function DocumentsView({
  entries,
  selected,
  recent,
  query,
  busy,
  loading,
  error,
  warnings,
  selectedPath,
  hasFolder,
  open,
  choose,
  syncControl,
  source,
}: {
  entries: Entry[];
  source?: (path: string) => { folder: string; path: string } | undefined;
  selected: string | null;
  recent: boolean;
  query: string;
  busy: boolean;
  loading: boolean;
  error: string;
  warnings: string[];
  selectedPath?: string;
  hasFolder: boolean;
  open: (path: string) => void;
  choose: () => void;
  syncControl?: ReactNode;
}) {
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const [limit, setLimit] = useState(60);
  const scroll = useRef<HTMLDivElement>(null);
  const notes = useMemo(() => {
    const filtered = entries.filter(
      (entry) => !selected || entry.path.slice(0, entry.path.lastIndexOf("/")) === selected,
    );
    filtered.sort(
      (a, b) =>
        (recent || sort === "recent" ? b.modified - a.modified : 0) ||
        a.name.localeCompare(b.name) ||
        a.path.localeCompare(b.path),
    );
    return recent ? filtered.slice(0, 50) : filtered;
  }, [entries, selected, recent, sort]);
  useEffect(() => {
    setLimit(60);
    scroll.current?.scrollTo(0, 0);
  }, [selected, recent, query, sort]);
  return (
    <section className="documents-view" aria-label="Notes overview">
      <div className="documents-list-heading">
        <div>
          <h2>
            {query
              ? "Search results"
              : selected?.split("/").pop() ||
                (recent ? "Recently changed" : "All files")}{" "}
            <span className="heading-count">{notes.length}</span>
          </h2>
          <small title={selected || "All folders"}>
            {selected || "All folders"}
          </small>
        </div>
        <div className="documents-list-actions">
          {syncControl}
          <label className="document-sort">
            Sort{" "}
            <select
              aria-label="Sort files"
              value={recent ? "recent" : sort}
              disabled={recent}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="recent">Recent</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>
      <div className="documents-status" role="status">
        {loading
          ? "Checking your files…"
          : `${notes.length} ${query ? "matching " : ""}supported files`}
      </div>
      {error && (
        <div className="list-warning" role="alert">
          {error}
        </div>
      )}
      {warnings.length > 0 && (
        <details className="list-warning">
          <summary>Some files could not be searched</summary>
          {warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </details>
      )}
      <div className="document-rows" ref={scroll}>
        {notes.slice(0, limit).map((note) => (
          <DocumentActions key={note.path} folder={note.remarkableId ? undefined : source?.(note.path)?.folder} path={source?.(note.path)?.path ?? note.path} disabled={busy}><button
            className="document-card"
            aria-label={fileKind(note.path) === "markdown" ? note.name.replace(/\.(md|markdown)$/i, "") : note.name}
            title={note.path}
            aria-current={selectedPath === note.path ? "page" : undefined}
            disabled={busy}
            onClick={() => open(note.path)}
          >
            <DocumentIcon path={note.path} remarkable={!!note.remarkableId} />
            <span className="document-card-body">
              <strong>{fileKind(note.path) === "markdown" ? note.name.replace(/\.(md|markdown)$/i, "") : note.name}</strong>
              <small>{note.path}</small>
              {note.snippet && <p>{note.snippet}</p>}
              {note.modified > 0 && (
                <time
                  dateTime={new Date(note.modified).toISOString()}
                  title={new Date(note.modified).toLocaleString()}
                >
                  {new Date(note.modified).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </time>
              )}
            </span>
            <ArrowUpRight size={15} />
          </button></DocumentActions>
        ))}
        {notes.length > limit && (
          <button
            className="task-show-more"
            onClick={() => setLimit((value) => value + 60)}
          >
            Show more files · {notes.length - limit} remaining
          </button>
        )}
        {!loading && !error && notes.length === 0 && (
          <div className="page-empty">
            <FolderOpen size={30} />
            <h2>
              {!hasFolder
                ? "Open your folder"
                : query
                  ? "No matching files"
                  : "No supported files here yet"}
            </h2>
            <p>
              {hasFolder
                ? "Choose another folder, adjust your search, or create a note."
                : "Choose a local folder containing Markdown, PDF or image files."}
            </p>
            {!hasFolder && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={choose}
              >
                Open a notes folder
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
