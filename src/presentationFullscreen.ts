import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Return a cleanup operation that restores the state from before presenting.
// The caller also runs it when presentation closes while entry is still pending.
export async function enterPresentationFullscreen(): Promise<() => Promise<void>> {
  if (isTauri()) {
    const window = getCurrentWindow();
    const wasFullscreen = await window.isFullscreen();
    if (!wasFullscreen) await window.setFullscreen(true);
    return async () => { if (!wasFullscreen) await window.setFullscreen(false); };
  }
  const wasFullscreen = !!document.fullscreenElement;
  if (!wasFullscreen) await document.documentElement.requestFullscreen();
  return async () => { if (!wasFullscreen && document.fullscreenElement) await document.exitFullscreen(); };
}
