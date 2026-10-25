import type { RmTask } from "./rmTasks";
export function readRmTasks(data: string | null, signal: AbortSignal): Promise<RmTask[]> {
  signal.throwIfAborted();
  if (!data) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./rmTasks.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Task scan cancelled", "AbortError")); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("This page took too long to read.")); }, 15_000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ tasks?: RmTask[]; error?: string }>) => {
      cleanup();
      if (event.data.tasks) resolve(event.data.tasks); else reject(new Error(event.data.error ?? "Could not read notebook tasks."));
    };
    worker.onerror = () => { cleanup(); reject(new Error("Could not read notebook tasks.")); };
    try {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      worker.postMessage(bytes, [bytes.buffer]);
    } catch (cause) { cleanup(); reject(cause); }
  });
}
