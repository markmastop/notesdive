import { renderRmPage } from "./rmRender";

self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try { self.postMessage({ page: renderRmPage(event.data) }); }
  catch (cause) { self.postMessage({ error: String(cause) }); }
};
