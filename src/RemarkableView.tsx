import { DocumentIcon } from "./DocumentIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BookOpen, ChevronDown, ChevronRight, Cloud, ExternalLink, FileText, Folder, FolderOpen, Info, Link2, Maximize2, Minimize2, RefreshCw, Search, Star, Unplug, X } from "lucide-react";
import { desktop } from "./api";
import { invoke } from "@tauri-apps/api/core";
import { RemarkableViewer } from "./RemarkableViewer";
import { remarkableApi, remarkableDate, remarkableFolders, remarkablePath, remarkableRows, type RemarkableDetail, type RemarkableItem } from "./remarkable";

export function RemarkableView() {
  const [pdfHeader, setPdfHeader] = useState<HTMLDivElement | null>(null);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [items, setItems] = useState<RemarkableItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [folder, setFolder] = useState<string | null>("");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState(false);
  const [sort, setSort] = useState<"name" | "recent">("name");
  const [limit, setLimit] = useState(60);
  const [focused, setFocused] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RemarkableDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const operation = useRef(0);
  const selection = useRef(0);
  const scroll = useRef<HTMLDivElement>(null);
  const chosen = items.find((item) => item.id === selected);
  const currentFolder = items.find((item) => item.id === folder);
  const folders = useMemo(() => remarkableFolders(items), [items]);
  const visibleFolders = useMemo(() => remarkableFolders(items, expanded), [items, expanded]);
  const folderParents = useMemo(() => new Set(folders.map(({ item }) => item.parent)), [folders]);
  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items.filter((item) => !item.isFolder)) counts.set(item.parent, (counts.get(item.parent) ?? 0) + 1);
    return counts;
  }, [items]);
  const rows = useMemo(() => remarkableRows(items, folder, query, pinned, sort), [items, folder, query, pinned, sort]);
  const locked = busy || checking || detailLoading;

  const clearDetail = () => {
    selection.current++;
    setSelected(null); setShowInfo(false); setDetail(null); setDetailError(""); setDetailLoading(false);
  };
  const load = async (request: number) => {
    setProgress(null);
    clearDetail();
    try {
      const result = await remarkableApi.list((value) => {
        if (operation.current !== request) return;
        setProgress({ loaded: value.loaded, total: value.total });
        if (!updated) setItems(value.items);
      });
      if (operation.current !== request) return;
      setItems(result.items); setWarnings(result.warnings); setUpdated(new Date());
      window.dispatchEvent(new Event("notesdive-remarkable-changed"));
      setFolder((old) => old && !result.items.some((item) => item.isFolder && item.id === old) ? "" : old);
      setProgress(null);
    } catch (cause) {
      if (operation.current === request) {
        setItems(items); setProgress(null);
        setFolder((old) => old && !items.some((item) => item.isFolder && item.id === old) ? "" : old);
      }
      throw cause;
    }
  };
  const restore = async () => {
    const request = ++operation.current;
    setChecking(true); setError("");
    try {
      const exists = desktop && await remarkableApi.status();
      if (operation.current !== request) return;
      setConnected(exists); setChecking(false);
      if (exists) { setBusy(true); await load(request); }
    } catch (cause) { if (operation.current === request) setError(String(cause)); }
    finally { if (operation.current === request) { setChecking(false); setBusy(false); } }
  };
  useEffect(() => {
    void restore();
    return () => { operation.current++; selection.current++; };
  }, []);
  useEffect(() => { setLimit(60); scroll.current?.scrollTo(0, 0); }, [folder, query, pinned, sort]);

  const refresh = async () => {
    const request = ++operation.current;
    setBusy(true); setError("");
    try { await load(request); }
    catch (cause) { if (operation.current === request) setError(String(cause)); }
    finally { if (operation.current === request) setBusy(false); }
  };
  const pair = async () => {
    const request = ++operation.current;
    setBusy(true); setError("");
    try {
      await remarkableApi.pair(code.trim());
      if (operation.current !== request) return;
      setCode(""); setConnected(true);
      await load(request);
    } catch (cause) { if (operation.current === request) setError(String(cause)); }
    finally { if (operation.current === request) setBusy(false); }
  };
  const disconnect = async () => {
    const request = ++operation.current;
    setBusy(true); setError("");
    try {
      await remarkableApi.disconnect();
      if (operation.current !== request) return;
      window.dispatchEvent(new Event("notesdive-remarkable-changed"));
      setConnected(false); setExpanded(new Set()); setItems([]); setWarnings([]); setUpdated(null); setFolder(""); setQuery(""); setPinned(false); setCode(""); clearDetail();
    } catch (cause) { if (operation.current === request) setError(String(cause)); }
    finally { if (operation.current === request) setBusy(false); }
  };
  const browse = (id: string | null) => { setFolder(id); setQuery(""); clearDetail(); };
  const choose = async (item: RemarkableItem) => {
    if (item.isFolder) { browse(item.id); return; }
    const request = ++selection.current;
    setSelected(item.id); setShowInfo(false); setDetail(null); setDetailError(""); setDetailLoading(true);
    try {
      const result = await remarkableApi.detail(item.id);
      if (selection.current === request) setDetail(result);
    } catch (cause) { if (selection.current === request) setDetailError(String(cause)); }
    finally { if (selection.current === request) setDetailLoading(false); }
  };

  return <section className={`workspace-page notes-page remarkable-page ${focused && chosen ? "reader-focused" : ""}`} aria-label="reMarkable workspace">
    <div className="page-heading">
      <h1>reMarkable {connected && <span className="heading-count">{items.filter((item) => !item.isFolder).length}</span>}</h1>
      {connected && <div className="notes-heading-actions">
        <button className="quiet-button" disabled={locked} onClick={() => void refresh()} aria-label="Refresh reMarkable"><RefreshCw size={15} className={busy ? "spin" : ""} />Refresh</button>
        <button className="quiet-button" disabled={locked} onClick={() => void disconnect()}><Unplug size={15} />Disconnect</button>
      </div>}
    </div>
    {error && <div className="list-warning remarkable-warning" role="alert">{error} {updated && "The previous list is still shown."}
      {!connected && desktop && <button className="quiet-button" disabled={locked} onClick={() => void restore()}>Retry connection</button>}
    </div>}
    {checking ? <div className="page-empty" role="status"><Cloud size={30} /><p>Checking your reMarkable connection…</p></div>
      : !connected ? <div className="remarkable-connect">
        <div className="remarkable-connect-icon"><BookOpen size={30} /></div>
        <h2>Your notebooks, within reach.</h2>
        <p>Browse your reMarkable cloud folders alongside your notes and todos.</p>
        {desktop ? <form onSubmit={(event) => { event.preventDefault(); if (!busy) void pair(); }}>
          <button type="button" className="quiet-button" onClick={() => void invoke("open_web_link", { url: "https://my.remarkable.com/device/remarkable" }).catch(() => setError("Could not open the pairing page in your browser."))}><ExternalLink size={14} />Get a pairing code</button>
          <label htmlFor="remarkable-code">One-time code</label>
          <div className="remarkable-pair-input"><input id="remarkable-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={8} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="8-character code" disabled={busy} />
            <button className="primary-button" type="submit" disabled={busy || !/^[a-zA-Z0-9]{8}$/.test(code.trim())}><Link2 size={15} />{busy ? "Connecting…" : "Connect"}</button></div>
          <small>The connection is saved in your system keychain. Your notebooks stay in reMarkable Cloud.</small>
        </form> : <p>Open the NotesDive desktop app to connect your reMarkable.</p>}
        <p className="remarkable-scope">This first version browses folders and document details. Open notebooks and PDFs in the read-only viewer. Editing is coming later.</p>
      </div> : <>
        <div className="todo-controls">
          <div className="notes-filter-controls">
            <div className="task-filters" role="group" aria-label="reMarkable filter">
              <button aria-pressed={!pinned} onClick={() => setPinned(false)}>All</button>
              <button aria-pressed={pinned} onClick={() => setPinned(true)}><Star size={13} />Pinned</button>
            </div>
            <select className="notes-folder-select" aria-label="reMarkable folder" value={folder ?? "__all"} disabled={checking} onChange={(event) => browse(event.target.value === "__all" ? null : event.target.value)}>
              <option value="">My files</option><option value="__all">All documents</option>
              {folders.map(({ item, depth }) => <option key={item.id} value={item.id}>{"— ".repeat(Math.min(depth, 5))}{item.name}</option>)}
            </select>
          </div>
          <label className="task-search"><Search size={15} /><input aria-label="Search reMarkable" placeholder="Search reMarkable…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Clear reMarkable search" onClick={() => setQuery("")}><X size={13} /></button>}</label>
        </div>
        <div className="notes-browser">
          <aside className="notes-folder-panel">
            <nav className="document-folders" aria-label="reMarkable folders">
              <button className="folder-choice" aria-current={folder === "" ? "page" : undefined} disabled={checking} onClick={() => browse("")}><Cloud size={15} /><span>My files</span></button>
              <button className="folder-choice" aria-current={folder === null ? "page" : undefined} disabled={checking} onClick={() => browse(null)}><FileText size={15} /><span>All documents</span><b>{items.filter((item) => !item.isFolder).length}</b></button>
              <div className="task-documents-label">FOLDERS</div>
              {visibleFolders.map(({ item, depth }) => <div className="folder-choice-row" key={item.id} style={{ paddingLeft: Math.min(depth, 5) * 12 }}>
                {folderParents.has(item.id) ? <button className="folder-disclosure" aria-label={`Toggle reMarkable folder ${remarkablePath(item, items)}`} aria-expanded={expanded.has(item.id)} onClick={() => setExpanded((old) => {
                  const next = new Set(old);
                  if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                  return next;
                })}>{expanded.has(item.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="folder-disclosure" />}
                <button className="folder-choice" title={remarkablePath(item, items)} aria-label={`reMarkable folder ${remarkablePath(item, items)}`} aria-current={folder === item.id ? "page" : undefined} disabled={checking} onClick={() => browse(item.id)}>
                  {folder === item.id ? <FolderOpen size={14} /> : <Folder size={14} />}<span>{item.name}</span><b>{folderCounts.get(item.id) ?? 0}</b>
                </button>
              </div>)}
            </nav>
          </aside>
          <section className="documents-view" aria-label="reMarkable documents">
            <div className="documents-list-heading"><div><h2>{query.trim() ? "Search results" : folder === null ? "All documents" : currentFolder?.name ?? "My files"} <span className="heading-count">{rows.length}</span></h2><small title={currentFolder ? remarkablePath(currentFolder, items) : "reMarkable Cloud"}>{currentFolder ? remarkablePath(currentFolder, items) : "reMarkable Cloud"}</small></div>
              <label className="document-sort">Sort <select aria-label="Sort reMarkable documents" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="name">Name</option><option value="recent">Recent</option></select></label>
            </div>
            <div className="documents-status" role="status">{busy ? progress ? `Reading your cloud folders… ${progress.loaded} / ${progress.total}` : "Checking your cloud library…" : updated ? `${error ? "Last loaded" : "Updated"} ${updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Refresh to load your folders"}</div>
            {warnings.map((warning) => <div className="list-warning" key={warning}>{warning}</div>)}
            {currentFolder && !query && <button className="quiet-button remarkable-up" disabled={checking} onClick={() => browse(currentFolder.parent)}><ArrowUp size={13} />Parent folder</button>}
            <div className="document-rows" ref={scroll}>
              {rows.slice(0, limit).map((item) => <button className="document-card" key={item.id} title={remarkablePath(item, items)} aria-label={`${item.isFolder ? "Open folder" : "Document"} ${item.name}`} aria-current={selected === item.id ? "page" : undefined} disabled={checking || detailLoading || (busy && !item.isFolder)} onClick={() => void choose(item)}>
                {item.isFolder ? <Folder size={18} /> : <DocumentIcon path={item.name} remarkable />}<span className="document-card-body"><strong>{item.name}{item.pinned && <Star size={11} aria-label="Pinned" />}</strong><small>{query || folder === null ? remarkablePath(item, items) : item.isFolder ? "Folder" : "Document"}</small>{item.modified && <time>{remarkableDate(item.modified)}</time>}</span><ChevronRight size={15} />
              </button>)}
              {rows.length > limit && <button className="task-show-more" onClick={() => setLimit((old) => old + 60)}>Show more · {rows.length - limit} remaining</button>}
              {!busy && updated && rows.length === 0 && <div className="page-empty"><FolderOpen size={28} /><h2>{query || pinned ? "No matching items" : "This folder is empty"}</h2><p>{query || pinned ? "Try another search or filter." : "Your latest synced items will appear here."}</p></div>}
            </div>
          </section>
          <section className="notes-reader" aria-label="reMarkable document details">
            {chosen ? <>
              <div className="notes-reader-header"><span className="notes-reader-path" title={remarkablePath(chosen, items)}>{remarkablePath(chosen, items)}</span><span className="remarkable-readonly">Read only</span>
                <div className="document-pdf-slot" ref={setPdfHeader} />
                <button className="icon-button" aria-label="Show document details" aria-pressed={showInfo} onClick={() => setShowInfo((value) => !value)}><Info size={15} /></button>
                <button className="icon-button" aria-label={focused ? "Show reMarkable folders" : "Focus reMarkable viewer"} onClick={() => { setExpanded(new Set()); setFocused((value) => !value); }}>{focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
              </div>
              <div className="remarkable-details" hidden={!showInfo}><BookOpen size={32} /><h2>{chosen.name}</h2>
                <dl><dt>Location</dt><dd>{remarkablePath(chosen, items)}</dd><dt>Last modified</dt><dd>{remarkableDate(chosen.modified)}</dd>
                  {detail && <><dt>Type</dt><dd>{detail.fileType === "notebook" ? "Notebook" : detail.fileType.toUpperCase()}</dd><dt>Pages</dt><dd>{detail.pageCount ?? "Unknown"}</dd>{detail.orientation && <><dt>Orientation</dt><dd>{detail.orientation}</dd></>}</>}
                </dl>
              </div>
              <div className="remarkable-preview-pane" hidden={showInfo}>
                {detailLoading ? <p className="asset-message" role="status">Loading document details…</p>
                  : detailError ? <div className="asset-message" role="alert">{detailError}<button className="quiet-button" disabled={locked} onClick={() => void choose(chosen)}>Retry details</button></div>
                  : detail && <RemarkableViewer key={chosen.id} id={chosen.id} name={chosen.name} detail={detail} exportTarget={pdfHeader} />}
              </div>
            </> : <div className="page-empty remarkable-reader-empty"><BookOpen size={34} /><h2>A place for your notebooks.</h2><p>Select a notebook or PDF to open it.</p><small>Pages are downloaded only when you open them.</small></div>}
          </section>
        </div>
      </>}
  </section>;
}
