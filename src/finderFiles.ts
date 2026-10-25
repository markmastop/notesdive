import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Folder, Note } from "./api";
import type { DocumentSession } from "./session";

interface Request { id: string }
export interface FinderBridge {
  listen(ready: () => void): Promise<() => void>;
  pending(): Promise<Request[]>;
  open(id: string): Promise<{ folder: Folder; note: Note }>;
}
const bridge: FinderBridge = {
  listen: (ready) => listen("finder-files-ready", ready),
  pending: () => invoke("pending_finder_files"),
  open: (id) => invoke("open_finder_file", { id }),
};

// Listen before fetching retained startup requests. Serialize multiple Finder
// opens, and wait for an in-progress editor transition before touching its draft.
export function watchFinderFiles(
  session: DocumentSession,
  restored: Promise<unknown>,
  opened: () => void,
  source = bridge,
) {
  let alive = true;
  let ready = false;
  let running = false;
  let unlisten: (() => void) | undefined;
  const seen = new Set<string>();
  const queue: Request[] = [];
  const pump = async () => {
    if (!alive || !ready || running || session.getSnapshot().busy) return;
    running = true;
    try {
      while (alive && queue.length && !session.getSnapshot().busy) {
        const request = queue.shift()!;
        if (await session.openExternal(() => source.open(request.id)) && alive) opened();
        // A failed save must keep the current document and stop later opens too.
        if (session.dirty || session.getSnapshot().conflict) {
          queue.length = 0;
          break;
        }
      }
    } finally { running = false; }
  };
  const refresh = async () => {
    try {
      const requests = await source.pending();
      if (!alive) return;
      for (const request of requests ?? []) {
        if (!seen.has(request.id)) { seen.add(request.id); queue.push(request); }
      }
      void pump();
    } catch (error) { if (alive) session.report(error); }
  };
  const unsubscribe = session.subscribe(() => { void pump(); });
  void (async () => {
    try {
      const stop = await source.listen(() => { void refresh(); });
      if (!alive) { stop(); return; }
      unlisten = stop;
      await restored;
      if (!alive) return;
      ready = true;
      await refresh();
    } catch (error) { if (alive) session.report(error); }
  })();
  return () => { alive = false; unsubscribe(); unlisten?.(); };
}
