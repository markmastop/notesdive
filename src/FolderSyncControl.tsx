import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Folder, Folders, GitMerge, Pause, RefreshCw, Tablet } from "lucide-react";
import type { Project, RemarkableSyncFolder } from "./projects";
import { folderName } from "./projects";
import type { SyncReport } from "./remarkableFolderSync";
import { folderSyncLink } from "./folderSync";

export function FolderSyncControl({ project, folder, path, label, disabled, save, run, openRequest, onOpenRequestHandled }: {
  project: Project; folder: string; path: string; label: string; disabled: boolean;
  onOpenRequestHandled?: () => void;
  openRequest?: { id: number; trigger: HTMLElement };
  save: (link: RemarkableSyncFolder) => Promise<void>;
  run: (link: RemarkableSyncFolder) => Promise<SyncReport>;
}) {
  const link = folderSyncLink(project, folder, path);
  const inherited = !!link && link.path !== path;
  const targets = project.remarkableFolders ?? [];
  const name = path.split("/").pop() || folderName(folder);
  const [mode, setMode] = useState<"enable" | "disable" | "details" | null>(null);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (mode) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else {
      dialog.current?.close();
      trigger.current?.focus();
    }
  }, [mode]);
  const open = (next: NonNullable<typeof mode>, element: HTMLElement) => {
    trigger.current = element;
    setTarget(link?.remoteParentId ?? targets[0]?.id ?? "");
    setError(""); setMode(next);
  };
  const handledRequest = useRef<typeof openRequest>(undefined);
  useEffect(() => {
    if (!openRequest || handledRequest.current === openRequest || !link?.enabled) return;
    handledRequest.current = openRequest;
    open("details", openRequest.trigger);
    onOpenRequestHandled?.();
  }, [openRequest, link]);
  const close = () => { if (!saving && !running) setMode(null); };
  const submit = async () => {
    if (mode === "details") { close(); return; }
    setSaving(true); setError("");
    try {
      await save({ ...link, id: link?.id ?? crypto.randomUUID(), localFolder: folder, path,
        remoteParentId: target, enabled: mode === "enable" });
      setMode(null);
    } catch (cause) { setError(String(cause)); }
    finally { setSaving(false); }
  };
  const syncNow = async () => {
    if (!link || running) return;
    setRunning(true); setError(""); setReport(null);
    try { setReport(await run(link)); }
    catch (cause) { setError(String(cause)); }
    finally { setRunning(false); }
  };
  const parent = targets.find((item) => item.id === target);
  return <div className="folder-sync-control">
    <label className="folder-sync-switch" title={inherited ? `Sync setup inherited from ${link.path || folderName(folder)}` : "Configure reMarkable sync"}>
      <input type="checkbox" role="switch" aria-label={`Sync ${name} with reMarkable`}
        checked={!!link?.enabled} disabled={disabled || inherited || saving || running}
        onChange={(event) => open(link?.enabled ? "disable" : "enable", event.currentTarget)} />
      <span>Sync</span>
    </label>
    {link?.enabled && <button type="button" className="folder-sync-details" onClick={(event) => open("details", event.currentTarget)}
      aria-label={`Sync setup for ${name}`} disabled={disabled || running} title="Synchronise this folder with reMarkable"><RefreshCw size={13} /></button>}
    <dialog ref={dialog} className="modal folder-sync-dialog" aria-labelledby="folder-sync-title" aria-describedby="folder-sync-description"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
      } }}>
      <RefreshCw size={20} className="folder-sync-modal-icon" />
      <h2 id="folder-sync-title">{mode === "disable" ? `Pause sync for ${name}?` : `${name}, on both devices.`}</h2>
      <p id="folder-sync-description">{mode === "disable" ? "Your local notes and reMarkable notebooks will stay where they are." : inherited ? `This folder is included in ${link.path || folderName(folder)}. Sync now transfers changes for that entire sync folder.` : "Enabling saves the setup. Then open the sync icon and choose Sync now to transfer this folder."}</p>
      {mode !== "disable" && <>
        {targets.length > 1 && <label className="folder-sync-target">reMarkable destination
          <select aria-label="reMarkable sync destination" value={target} disabled={saving || mode === "details" || !!(link?.state?.files.length || link?.state?.pdfs?.length)} onChange={(event) => setTarget(event.target.value)}>
            {targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        <div className="folder-sync-route">
          <div><Folder size={16} /><span>{inherited ? `${folderName(folder)}/${link.path}` : label}</span></div>
          <span className="folder-sync-arrow">↕</span>
          <div><Tablet size={16} /><span>{parent ? `reMarkable / ${parent.name} / ${inherited ? link.path.split("/").pop() || folderName(folder) : name}` : "Link a reMarkable folder in project settings first"}</span></div>
        </div>
        <div className="folder-sync-explanation">
          <div><Folders size={16} /><section><strong>Your folder travels with you.</strong><p>The first sync will create {name} under the destination, including subfolders, Markdown notes and PDFs.</p></section></div>
          <div><ArrowLeftRight size={16} /><section><strong>Edit typed text on either device.</strong><p>Markdown here, editable notebooks on reMarkable. Handwriting stays in the notebook. Original .rm pages are saved locally in .notesdive-sync as attachments.</p></section></div>
          <div><GitMerge size={16} /><section><strong>Changed on both sides?</strong><p>Conflicting edits will keep both versions for you to review.</p></section></div>
          <div><Pause size={16} /><section><strong>You stay in control.</strong><p>Sync never deletes files or folders on either device. Turning Sync off keeps everything in place.</p></section></div>
        </div>
      </>}
      <p className="folder-sync-development" role="status">{running ? "Synchronising… Keep NotesDive open until this finishes." : "Enabling Sync does not transfer files. Use Sync now to create the folder and transfer Markdown notes and PDFs. PDFs are uploaded for reading and annotating. Images and other assets are not uploaded. Headings (levels 1–2), bold, italic, bullets and checkboxes are supported. Unsupported files are skipped. Changed local PDFs create new versions, preserving old annotated copies. PDF handwriting is backed up as .rm attachments; a rendered annotation PDF is not available yet. Only original single-page notebooks are updated; deletions and new tablet notebooks are not imported automatically."}</p>
      {mode === "details" && link?.state?.lastSync && <p>Last sync: {new Date(link.state.lastSync).toLocaleString()}</p>}
      {report && <div role="status"><p>{report.uploaded} sent · {report.downloaded} received · {report.unchanged} up to date</p>
        {!!report.createdFolders && <p>{report.createdFolders} folders created on reMarkable.</p>}
        {!!report.attachments?.length && <><p>Tablet copies and handwriting attachments saved locally:</p><ul>{report.attachments.map(path => <li key={path}>{path}</li>)}</ul></>}
        {report.conflicts.length > 0 && <><p>Changed on both sides. Review these tablet copies:</p><ul>{report.conflicts.map(path => <li key={path}>{path}</li>)}</ul></>}
        {report.warnings.length > 0 && <><p>Kept unchanged:</p><ul>{report.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></>}
      </div>}
      {error && <p className="modal-error" role="alert">{error}</p>}
      <div className="modal-actions">
        {mode === "details" && <button type="button" className="primary-button" disabled={disabled || running || saving} onClick={() => void syncNow()}>{running ? "Synchronising…" : "Sync now"}</button>}
        {mode !== "details" && <button type="button" disabled={saving || running} onClick={close}>Cancel</button>}
        <button type="button" className={mode === "details" ? undefined : "primary-button"} disabled={saving || running || (mode === "enable" && !parent)} onClick={() => void submit()}>
          {saving ? "Saving…" : mode === "details" ? "Done" : mode === "disable" ? "Pause sync" : "Enable sync"}
        </button>
      </div>
    </dialog>
  </div>;
}
