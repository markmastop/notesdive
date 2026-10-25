import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, RefreshCw, Tablet, X } from "lucide-react";
import { remarkableApi, remarkableFolders, remarkablePath, type RemarkableItem } from "./remarkable";
import type { RemarkableFolderLink } from "./projects";

export function RemarkableFolderPicker({ linked, disabled, change }: {
  linked: RemarkableFolderLink[]; disabled: boolean; change: (links: RemarkableFolderLink[]) => void;
}) {
  const [items, setItems] = useState<RemarkableItem[] | null>(null);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    setBusy(true); setError("");
    try {
      if (!await remarkableApi.status()) throw new Error("Connect reMarkable on the reMarkable page, then return here to link a folder.");
      const listing = await remarkableApi.list(() => {});
      setItems(listing.items); setExpanded(new Set());
      if (listing.warnings.length) setError(listing.warnings.join(" "));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const folders = items ? remarkableFolders(items, expanded) : [];
  const parents = new Set(items?.filter((item) => item.isFolder).map((item) => item.parent));
  return <fieldset className="remarkable-folder-picker" disabled={disabled}>
    <legend><Tablet size={16} /> reMarkable folders</legend>
    <p>Show these folders and their subfolders with this project's files and tasks. Read only. Typed checkbox tasks are included; handwriting is not recognized.</p>
    {linked.map((link) => <div className="remarkable-linked-folder" key={link.id}>
      <Folder size={15} /><span>{link.name}</span>
      <button type="button" className="icon-button" aria-label={`Unlink reMarkable folder ${link.name}`} disabled={busy || disabled}
        onClick={() => change(linked.filter((current) => current.id !== link.id))}><X size={14} /></button>
    </div>)}
    <button type="button" className="quiet-button" disabled={busy || disabled} onClick={() => void load()}>
      <RefreshCw size={14} className={busy ? "spin" : ""} />{busy ? "Loading folders…" : items ? "Refresh reMarkable folders" : "Choose reMarkable folders"}
    </button>
    {error && <p className="list-warning" role="alert">{error}</p>}
    {items && <div className="remarkable-folder-options" role="group" aria-label="Choose reMarkable project folders">
      {folders.map(({ item, depth }) => <div className="folder-choice-row" key={item.id} style={{ paddingLeft: Math.min(depth, 5) * 12 }}>
        {parents.has(item.id) ? <button type="button" className="folder-disclosure" aria-label={`Toggle reMarkable folder ${remarkablePath(item, items)}`}
          aria-expanded={expanded.has(item.id)} onClick={() => setExpanded((old) => {
            const next = new Set(old); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next;
          })}>{expanded.has(item.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button> : <span className="folder-disclosure" />}
        <label><input type="checkbox" checked={linked.some((link) => link.id === item.id)}
          onChange={(event) => change(event.target.checked ? [...linked, { id: item.id, name: item.name }] : linked.filter((link) => link.id !== item.id))} />
          <Folder size={14} /><span>{item.name}</span>
        </label>
      </div>)}
      {!folders.length && <p>No reMarkable folders found.</p>}
    </div>}
  </fieldset>;
}
