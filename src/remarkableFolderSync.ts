import { invoke } from "@tauri-apps/api/core";
import type { Projects } from "./projects";
import { canonicalMarkdown, decodeNotebook, encodeNotebook, fromBase64, toBase64 } from "./remarkableSyncCodec";
export interface SyncMapping { path: string; documentId: string; pageId: string; localHash: string; remoteHash: string }
export interface SyncJournal { folders: Record<string, string>; files: SyncMapping[]; pdfs?: { path: string; documentId: string; localHash: string; remoteHash: string; annotationHash: string; previousDocuments: string[] }[]; lastSync?: number; publishedFolders?: string[] }
export interface SyncNote { mapping: SyncMapping; local?: { content: string; revision: string } | null; remoteHash?: string | null; remoteData?: string | null; error?: string | null }
export interface SyncAction { path: string; action: "upload" | "download" | "conflict" | "unchanged" | "skip"; content?: string; data?: string }
export interface SyncReport { context: Projects; uploaded: number; downloaded: number; unchanged: number; createdFolders?: number; attachments?: string[]; conflicts: string[]; warnings: string[] }
export function planSync(note: SyncNote): SyncAction {
  const base = { path: note.mapping.path };
  if (note.error || !note.local) return { ...base, action: "skip", content: note.error ?? "Local file removed; deletions are not mirrored." };
  try {
    const localCanonical = canonicalMarkdown(note.local.content);
    if (!note.remoteData) return { ...base, action: "upload", data: toBase64(encodeNotebook(note.local.content, undefined, note.mapping.documentId)) };
    const remote = fromBase64(note.remoteData), remoteMarkdown = decodeNotebook(remote);
    if (localCanonical === remoteMarkdown) return { ...base, action: "unchanged" };
    const localChanged = note.local.revision !== note.mapping.localHash;
    const remoteChanged = note.remoteHash !== note.mapping.remoteHash;
    if (localChanged && remoteChanged) return { ...base, action: "conflict", content: remoteMarkdown };
    if (localChanged) return { ...base, action: "upload", data: toBase64(encodeNotebook(note.local.content, remote, note.mapping.documentId)) };
    if (remoteChanged) return { ...base, action: "download", content: remoteMarkdown };
    return { ...base, action: "skip", content: "Saved versions differ unexpectedly; both files were kept." };
  } catch (error) { return { ...base, action: "skip", content: String(error) }; }
}
export async function syncFolder(projectId: string, linkId: string, library: string | null): Promise<SyncReport> {
  const snapshot = await invoke<{ id: string; notes: SyncNote[]; pdfs?: { path: string; data?: string | null; error?: string | null }[] }>("remarkable_sync_snapshot", { projectId, linkId, library });
  try {
    const actions = snapshot.notes.map(planSync);
    const pdfActions = [];
    for (const pdf of snapshot.pdfs ?? []) {
      let pageCount: number | undefined, error = pdf.error ?? undefined;
      if (pdf.data && !error) {
        try {
          const { pdfPageCount } = await import("./remarkablePdfSync");
          pageCount = await pdfPageCount(fromBase64(pdf.data));
        } catch (cause) { error = String(cause); }
      }
      pdfActions.push({ path: pdf.path, pageCount: pageCount ?? null, error: error ?? null });
    }
    return await invoke("remarkable_sync_apply", { id: snapshot.id, actions, pdfActions });
  }
  finally { await invoke("remarkable_sync_cancel", { id: snapshot.id }).catch(() => {}); }
}
