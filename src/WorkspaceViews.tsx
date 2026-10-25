import { DocumentIcon } from "./DocumentIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CheckCheck,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Todo, TodoListing } from "./todos";
import { compareTodoUrgency, localToday } from "./todos";
import { TodoMetadata } from "./TodoMetadata";
export function TodosView({
  title = "Todos",
  tasks,
  warnings,
  files,
  loading,
  cloudLoading = false,
  error,
  busy,
  refresh,
  open,
  toggle,
  hasFolder,
  choose,
}: TodoListing & {
  title?: string;
  loading: boolean;
  cloudLoading?: boolean;
  error: string;
  busy: boolean;
  refresh: () => void;
  open: (path: string, page?: number) => void;
  toggle: (task: Todo) => void;
  hasFolder: boolean;
  choose: () => void;
}) {
  const [filter, setFilter] = useState<"open" | "done" | "all">("open");
  const [dueFilter, setDueFilter] = useState<"all" | "overdue" | "today" | "upcoming" | "undated">("all");
  const [sort, setSort] = useState<"source" | "due" | "priority">("source");
  const [query, setQuery] = useState("");
  const [document, setDocument] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(30);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLimit(30);
    resultsRef.current?.scrollTo(0, 0);
  }, [document, filter, query]);
  const counts = {
    open: tasks.filter((t) => !t.checked).length,
    done: tasks.filter((t) => t.checked).length,
    all: tasks.length,
  };
  const groups = useMemo(() => {
    const groups = new Map<string, Todo[]>();
    const today = localToday();
    for (const task of tasks) {
      if (
        (filter === "open" && task.checked) ||
        (filter === "done" && !task.checked)
      )
        continue;
      if (
        !`${task.text} ${task.path}`
          .toLowerCase()
          .includes(query.toLowerCase().trim())
      )
        continue;
      if (dueFilter === "overdue" && (!task.due || task.due >= today || task.checked)) continue;
      if (dueFilter === "today" && task.due !== today) continue;
      if (dueFilter === "upcoming" && (!task.due || task.due <= today)) continue;
      if (dueFilter === "undated" && task.due) continue;
      const group = groups.get(task.path) ?? [];
      group.push(task);
      groups.set(task.path, group);
    }
    for (const rows of groups.values()) {
      if (sort === "due") rows.sort(compareTodoUrgency);
      if (sort === "priority") {
        const rank = { urgent: 0, high: 1, normal: 2, medium: 2, low: 3 };
        rows.sort((a, b) => (rank[a.priority ?? "normal"] - rank[b.priority ?? "normal"]) || compareTodoUrgency(a, b));
      }
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  }, [tasks, filter, query, dueFilter, sort]);
  return (
    <section className="workspace-page todo-page" aria-label="Todos">
      <div data-todo-export className="pdf-export-source" aria-hidden="true">
        <p>{filter === "all" ? "All tasks" : filter === "done" ? "Completed tasks" : "Open tasks"} · Due: {dueFilter}{query ? ` · Search: ${query}` : ""}</p>
        {groups.filter(([path]) => document === null || path === document).map(([path, rows]) => (
          <section key={path}><h2>{path}</h2><ul>
            {rows.map((task) => <li key={task.line}><span>{task.checked ? "[x]" : "[ ]"} {task.text}</span> <TodoMetadata task={task} /></li>)}
          </ul></section>
        ))}
        {!groups.length && <p>No matching tasks.</p>}
      </div>
      <div className="page-heading">
        <h1>
          {title}{" "}
          <span
            className="heading-count"
            title={`${files} source documents checked`}
          >
            {counts.open}
          </span>
        </h1>
        <button
          className="quiet-button"
          onClick={refresh}
          disabled={!hasFolder || busy || loading || cloudLoading}
          aria-label="Refresh tasks"
        >
          <RefreshCw size={15} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>
      {!hasFolder ? (
        <div className="page-empty">
          <p>Open a folder to collect tasks from your Markdown files.</p>
          <button className="primary-button" onClick={choose} disabled={busy}>
            Open a notes folder
          </button>
        </div>
      ) : (
        <>
          {cloudLoading && <p className="home-empty" role="status">Reading reMarkable checkbox tasks… Local tasks remain available.</p>}
      <div className="todo-controls">
            <div className="task-filters" role="group" aria-label="Task filter">
              {(["open", "done", "all"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {value === "open"
                    ? "Open"
                    : value === "done"
                      ? "Completed"
                      : "All"}
                  <span>{counts[value]}</span>
                </button>
              ))}
            </div>
            <label className="task-search">
              <Search size={15} />
              <input
                aria-label="Search tasks"
                placeholder="Search tasks or files"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setDocument(null);
                }}
              />
            </label>
            <label className="todo-select">Due <select aria-label="Filter by due date" value={dueFilter} onChange={(event) => setDueFilter(event.target.value as typeof dueFilter)}><option value="all">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="upcoming">Upcoming</option><option value="undated">No date</option></select></label>
            <label className="todo-select">Sort <select aria-label="Sort tasks" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="source">In note order</option><option value="due">Due date</option><option value="priority">Priority</option></select></label>
          </div>
          {error && (
            <p className="list-warning" role="alert">
              {error}
            </p>
          )}
          {warnings.length > 0 && (
            <details className="list-warning">
              <summary>
                Some files could not be checked ({warnings.length})
              </summary>
              {warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </details>
          )}
          <div className="todo-browser">
            <nav className="task-documents" aria-label="Task documents">
              <button
                className="task-document-choice"
                aria-current={document === null ? "page" : undefined}
                onClick={() => setDocument(null)}
              >
                <span>All documents</span>
                <b>{groups.reduce((sum, [, rows]) => sum + rows.length, 0)}</b>
              </button>
              <div className="task-documents-label">
                DOCUMENTS · {groups.length}
              </div>
              {groups.map(([path, rows]) => (
                <button
                  key={path}
                  className="task-document-choice"
                  aria-current={document === path ? "page" : undefined}
                  title={path}
                  onClick={() => setDocument(path)}
                >
                  <DocumentIcon path={path} remarkable={rows.some((task) => !!task.remarkableId)} size={20} />
                  <span>
                    <strong>
                      {path
                        .split("/")
                        .pop()
                        ?.replace(/\.(md|markdown)$/i, "")}
                    </strong>
                    <small>
                      {path.includes("/")
                        ? path.slice(0, path.lastIndexOf("/"))
                        : "Workspace"}
                    </small>
                  </span>
                  <b>{rows.length}</b>
                </button>
              ))}
            </nav>
            <div className="task-results" ref={resultsRef}>
              <div className="task-results-heading">
                <span>
                  {document || `${groups.length} documents with matching tasks`}
                </span>
                {document ? (
                  <button onClick={() => setDocument(null)}>
                    All documents
                  </button>
                ) : (
                  <div>
                    <button
                      onClick={() =>
                        setCollapsed(new Set(groups.map(([path]) => path)))
                      }
                    >
                      Collapse all
                    </button>
                    <button onClick={() => setCollapsed(new Set())}>
                      Expand all
                    </button>
                  </div>
                )}
              </div>
              {groups
                .filter(([path]) => document === null || path === document)
                .map(([path, rows]) => {
                  const closed = document === null && collapsed.has(path);
                  const visible = rows.slice(0, document === null ? 3 : limit);
                  return (
                    <section
                      className="task-group"
                      key={path}
                      aria-label={path}
                    >
                      <div className="task-group-header">
                        <button
                          className="task-group-toggle"
                          aria-label={`Toggle tasks in ${path}`}
                          aria-expanded={!closed}
                          onClick={() => {
                            if (document) return;
                            setCollapsed((previous) => {
                              const next = new Set(previous);
                              if (next.has(path)) next.delete(path);
                              else next.add(path);
                              return next;
                            });
                          }}
                          disabled={document !== null}
                        >
                          {closed ? (
                            <ChevronRight size={15} />
                          ) : (
                            <ChevronDown size={15} />
                          )}
                          <span>{path}</span>
                          <b>{rows.length}</b>
                        </button>
                        <button
                          className="icon-button"
                          title="Open note"
                          aria-label={`Open note ${path}`}
                          onClick={() => open(path)}
                          disabled={busy}
                        >
                          <ArrowUpRight size={15} />
                        </button>
                      </div>
                      {!closed && (
                        <>
                          {visible.map((task) => (
                            <div
                              className={`task-row ${task.checked ? "completed" : ""}`}
                              key={task.offset}
                            >
                              <input
                                type="checkbox"
                                checked={task.checked}
                                disabled={busy || loading || task.readOnly}
                                onChange={() => toggle(task)}
                                aria-label={`${task.checked ? "Reopen" : "Complete"}: ${task.text}`}
                              />
                              <button
                                className="task-content"
                                onClick={() => open(task.path, task.page)}
                                disabled={busy}
                              >
                                <span className="task-main"><span>{task.text}</span><TodoMetadata task={task} /></span>
                                <small>{task.readOnly ? `reMarkable · Page ${task.page} · Read only` : `Line ${task.line}`}</small>
                              </button>
                            </div>
                          ))}
                          {rows.length > visible.length && (
                            <button
                              className="task-show-more"
                              onClick={() => {
                                if (document === null) setDocument(path);
                                else setLimit((value) => value + 30);
                              }}
                            >
                              {document === null
                                ? `View all ${rows.length} tasks`
                                : `Show more · ${rows.length - visible.length} remaining`}
                              <ChevronRight size={14} />
                            </button>
                          )}
                        </>
                      )}
                    </section>
                  );
                })}
              {document && !groups.some(([path]) => path === document) && (
                <div className="page-empty">
                  <CheckCheck size={28} />
                  <h2>No matching tasks in this document.</h2>
                  <button
                    className="quiet-button"
                    onClick={() => setDocument(null)}
                  >
                    View all documents
                  </button>
                </div>
              )}
              {!loading && !error && groups.length === 0 && (
                <div className="page-empty">
                  <CheckCheck size={30} />
                  <h2>
                    {query
                      ? "No matching tasks"
                      : filter === "open"
                        ? "Nothing left on the list."
                        : "No tasks here yet."}
                  </h2>
                  <p>
                    {query ? (
                      "Try a different word or file name."
                    ) : (
                      <>
                        Add a task in any note using{" "}
                        <code>- [ ] Your next step</code>.
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
