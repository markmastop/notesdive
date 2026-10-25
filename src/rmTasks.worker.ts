import { extractRmTasks } from "./rmTasks";
self.onmessage = (event: MessageEvent<Uint8Array>) => {
  try { self.postMessage({ tasks: extractRmTasks(event.data) }); }
  catch (cause) { self.postMessage({ error: String(cause) }); }
};
