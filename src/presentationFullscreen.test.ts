import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { enterPresentationFullscreen } from "./presentationFullscreen";

const native = vi.hoisted(() => ({ isTauri: vi.fn(), isFullscreen: vi.fn(), setFullscreen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: native.isTauri }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

beforeEach(() => {
  vi.resetAllMocks();
  native.isTauri.mockReturnValue(true);
  native.isFullscreen.mockResolvedValue(false);
  native.setFullscreen.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

it("enters native fullscreen and restores a windowed desktop on exit", async () => {
  const exit = await enterPresentationFullscreen();
  expect(native.setFullscreen).toHaveBeenCalledWith(true);
  await exit();
  expect(native.setFullscreen.mock.calls).toEqual([[true], [false]]);
});

it("preserves an already fullscreen desktop window", async () => {
  native.isFullscreen.mockResolvedValue(true);
  await (await enterPresentationFullscreen())();
  expect(native.setFullscreen).not.toHaveBeenCalled();
});

it("reports native entry failures", async () => {
  native.setFullscreen.mockRejectedValue(new Error("Unavailable"));
  await expect(enterPresentationFullscreen()).rejects.toThrow("Unavailable");
});

it("uses browser fullscreen and only exits the fullscreen session it started", async () => {
  native.isTauri.mockReturnValue(false);
  const document = { fullscreenElement: null as object | null, documentElement: { requestFullscreen: vi.fn(async () => { document.fullscreenElement = {}; }) }, exitFullscreen: vi.fn(async () => { document.fullscreenElement = null; }) };
  vi.stubGlobal("document", document);
  const exit = await enterPresentationFullscreen();
  expect(document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
  await exit();
  expect(document.exitFullscreen).toHaveBeenCalledOnce();
  document.fullscreenElement = {};
  document.exitFullscreen.mockClear();
  await (await enterPresentationFullscreen())();
  expect(document.exitFullscreen).not.toHaveBeenCalled();
});

it("does not exit browser fullscreen again after the system already left it", async () => {
  native.isTauri.mockReturnValue(false);
  const document = { fullscreenElement: null as object | null, documentElement: { requestFullscreen: vi.fn(async () => { document.fullscreenElement = {}; }) }, exitFullscreen: vi.fn() };
  vi.stubGlobal("document", document);
  const exit = await enterPresentationFullscreen();
  document.fullscreenElement = null;
  await exit();
  expect(document.exitFullscreen).not.toHaveBeenCalled();
});
