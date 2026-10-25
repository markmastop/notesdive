import type { RenderedRmPage } from "./rmRender";

export function renderRmPreview(data: string | null, signal?: AbortSignal): Promise<RenderedRmPage> {
  signal?.throwIfAborted();
  if (data === null) return Promise.resolve({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1404 1872"/>', width: 1404, height: 1872 });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./rmRender.worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { clearTimeout(timeout); worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Export cancelled", "AbortError")); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("This page took too long to render. Try another page or retry.")); }, 15_000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ page?: RenderedRmPage; error?: string }>) => {
      cleanup();
      if (event.data.page) resolve(event.data.page);
      else reject(new Error(event.data.error ?? "Could not render this notebook page."));
    };
    worker.onerror = () => { cleanup(); reject(new Error("Could not render this notebook page.")); };
    try {
      const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      worker.postMessage(bytes, [bytes.buffer]);
    } catch (cause) { cleanup(); reject(cause); }
  });
}
