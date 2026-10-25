import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export type DocumentAction = "rename" | "trash" | "reveal";
export const DocumentActionContext = createContext<(folder: string, path: string, action: DocumentAction, name?: string) => Promise<void>>(async () => {});

export function DocumentActions({ folder, path, disabled, children }: { folder?: string; path: string; disabled?: boolean; children: ReactNode }) {
  const action = useContext(DocumentActionContext);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const filename = path.split("/").pop()!;
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  const [name, setName] = useState(filename.slice(0, filename.length - extension.length));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const run = async (kind: DocumentAction) => {
    if (!folder || working) return;
    setWorking(true); setError("");
    try { await action(folder, path, kind, kind === "rename" ? name.trim() + extension : undefined); setMenu(false); setRenaming(false); }
    catch (e) { setError(String(e)); }
    finally { setWorking(false); }
  };
  return <div ref={root} className="document-action-row" onContextMenu={(event) => { if (folder && !disabled) { event.preventDefault(); setMenu(true); } }} onKeyDown={(event) => { if (event.key === "Escape") { setMenu(false); setRenaming(false); } }}>
    {renaming ? <form className="document-rename" onSubmit={(event) => { event.preventDefault(); void run("rename"); }}><input autoFocus onFocus={(event) => event.currentTarget.select()} aria-label="Document name" value={name} onChange={(event) => setName(event.target.value)} disabled={working}/><span>{extension}</span><button disabled={working || !name.trim()}>Save</button><button type="button" onClick={() => setRenaming(false)}>Cancel</button></form> : children}
    {folder && !renaming && <button className="document-more" aria-label={`Actions for ${filename}`} aria-expanded={menu} disabled={disabled || working} onClick={() => setMenu(!menu)}><MoreHorizontal size={18}/></button>}
    {menu && <div className="document-action-menu" role="group" aria-label="Document actions"><button onClick={() => { setMenu(false); setRenaming(true); }}>Rename</button><button onClick={() => void run("reveal")}>Show in Finder</button><hr/><button className="document-trash" disabled={working} onClick={() => void run("trash")}>Move to Trash</button></div>}
    {error && <small className="document-action-error" role="alert">{error}</small>}
  </div>;
}
