import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DocumentSession } from "./session";
import type { Note, NotesApi } from "./api";
function setup() {
  const disk = new Map<string, string>([
    ["a.md", "# First"],
    ["b.md", "# Second"],
  ]);
  const read = async (_folder: string, path: string): Promise<Note> => {
    if (!disk.has(path)) throw new Error("File not found");
    const content = disk.get(path)!;
    return { path, content, revision: content };
  };
  const api: NotesApi = {
    restore: async () => ({ path: "/notes", name: "Notes" }),
    choose: async () => null,
    workspaces: async () => [{ path: "/notes", name: "Notes" }],
    switchWorkspace: vi.fn(async (path) => ({ path, name: "Other notes" })),
    forgetWorkspace: async () => [],
    list: async () => ({ entries: [], warnings: [] }),
    read,
    readAsset: async () => ({ path: "image.png", mime: "image/png", data: "" }),
    save: vi.fn(async (_folder, note) => {
      if (disk.get(note.path) !== note.revision)
        throw new Error("CONFLICT: Changed on disk");
      disk.set(note.path, note.content);
      return { ...note, revision: note.content };
    }),
    create: async (folder, path, content) => {
      if (disk.has(path)) throw new Error("Already exists");
      disk.set(path, content);
      return read(folder, path);
    },
  };
  return { disk, api, session: new DocumentSession(api) };
}
describe("document lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("debounces autosave and acknowledges disk success", async () => {
    const { session, disk, api } = setup();
    await session.restore();
    await session.open("a.md");
    session.edit("Draft");
    await vi.advanceTimersByTimeAsync(300);
    session.edit("Final");
    await vi.advanceTimersByTimeAsync(649);
    expect(api.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(disk.get("a.md")).toBe("Final");
    expect(session.dirty).toBe(false);
  });
  it("keeps edits made during an in-flight save unsaved", async () => {
    const { session, api } = setup();
    await session.restore();
    await session.open("a.md");
    let finish!: (note: Note) => void;
    api.save = vi.fn(
      () =>
        new Promise<Note>((resolve) => {
          finish = resolve;
        }),
    );
    session.edit("snapshot");
    const pending = session.save();
    session.edit("newer");
    finish({ path: "a.md", content: "snapshot", revision: "snapshot" });
    await pending;
    expect(session.getSnapshot().text).toBe("newer");
    expect(session.getSnapshot().savedText).toBe("snapshot");
    expect(session.dirty).toBe(true);
  });
  it("flushes before switching notes and locks editing during navigation", async () => {
    const { session, disk } = setup();
    await session.restore();
    await session.open("a.md");
    session.edit("Keep me");
    const opened = session.open("b.md");
    session.edit("Too late");
    await opened;
    expect(disk.get("a.md")).toBe("Keep me");
    expect(session.getSnapshot().text).toBe("# Second");
  });
  it("saves a draft before switching folders and clears the old document", async () => {
    const { session, disk, api } = setup();
    await session.restore();
    await session.open("a.md");
    session.edit("Saved before switch");
    expect(await session.switchWorkspace("/other")).toBe(true);
    expect(disk.get("a.md")).toBe("Saved before switch");
    expect(api.switchWorkspace).toHaveBeenCalledWith("/other");
    expect(session.getSnapshot().folder?.path).toBe("/other");
    expect(session.getSnapshot().note).toBeNull();
  });
  it("keeps the current folder when a draft cannot be saved", async () => {
    const { session, api } = setup();
    await session.restore();
    await session.open("a.md");
    session.edit("Unsaved draft");
    api.save = async () => { throw new Error("Write failed"); };
    expect(await session.switchWorkspace("/other")).toBe(false);
    expect(api.switchWorkspace).not.toHaveBeenCalled();
    expect(session.getSnapshot().folder?.path).toBe("/notes");
    expect(session.getSnapshot().text).toBe("Unsaved draft");
  });
  it("removes the active shortcut without deleting notes", async () => {
    const { session, disk } = setup();
    await session.restore();
    await session.open("a.md");
    session.edit("Kept on disk");
    expect(await session.forgetWorkspace("/notes")).toBe(true);
    expect(session.getSnapshot().folder).toBeNull();
    expect(disk.get("a.md")).toBe("Kept on disk");
  });
  it("retains the draft and blocks navigation and close on failed writes", async () => {
    const { session, api } = setup();
    await session.restore();
    await session.open("a.md");
    api.save = async () => {
      throw new Error("Read-only volume");
    };
    session.edit("Important draft");
    expect(await session.open("b.md")).toBe(false);
    const close = vi.fn();
    expect(await session.close(close)).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(session.getSnapshot().text).toBe("Important draft");
    expect(session.getSnapshot().note?.path).toBe("a.md");
  });
  it("reloads clean notes and preserves dirty notes on external changes", async () => {
    const { session, disk } = setup();
    await session.restore();
    await session.open("a.md");
    disk.set("a.md", "External");
    await session.syncExternal();
    expect(session.getSnapshot().text).toBe("External");
    session.edit("My draft");
    disk.set("a.md", "External again");
    await session.syncExternal();
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().conflict).toBe(true);
    expect(session.getSnapshot().text).toBe("My draft");
    expect(disk.get("a.md")).toBe("External again");
    expect(await session.create("copy.md", true)).toBe(true);
    expect(disk.get("copy.md")).toBe("My draft");
    expect(session.getSnapshot().conflict).toBe(false);
  });
  it("detects external changes even before the watcher delivers its event", async () => {
    const { session, disk } = setup();
    await session.restore();
    await session.open("a.md");
    session.edit("Draft");
    disk.set("a.md", "Other app");
    expect(await session.save()).toBe(false);
    expect(session.getSnapshot().conflict).toBe(true);
    expect(disk.get("a.md")).toBe("Other app");
  });
  it("preserves Windows newlines and UTF-8 BOM when editing", async () => {
    const { session, disk } = setup();
    disk.set("a.md", "\uFEFF# First\r\nText\r\n");
    await session.restore();
    await session.open("a.md");
    expect(session.getSnapshot().text).toBe("# First\nText\n");
    session.edit("# First\nNew\n");
    await session.save();
    expect(disk.get("a.md")).toBe("\uFEFF# First\r\nNew\r\n");
  });
  it("retains text when the active note is externally deleted", async () => {
    const { session, disk } = setup();
    await session.restore();
    await session.open("a.md");
    disk.delete("a.md");
    await session.syncExternal();
    expect(session.getSnapshot().text).toBe("# First");
    expect(session.getSnapshot().conflict).toBe(true);
    await session.create("recovered.md", true);
    expect(disk.get("recovered.md")).toBe("# First");
  });
  it("canceling a folder picker keeps the workspace and note", async () => {
    const { session } = setup();
    await session.restore();
    await session.open("a.md");
    expect(await session.choose()).toBe(false);
    expect(session.getSnapshot().folder?.path).toBe("/notes");
    expect(session.getSnapshot().note?.path).toBe("a.md");
  });
  it("ignores a stale external read after navigation", async () => {
    const { session, api } = setup();
    await session.restore();
    await session.open("a.md");
    const original = api.read;
    let finish!: (note: Note) => void;
    api.read = () =>
      new Promise<Note>((resolve) => {
        finish = resolve;
      });
    const checking = session.syncExternal();
    api.read = original;
    await session.open("b.md");
    finish({ path: "a.md", content: "late", revision: "late" });
    await checking;
    expect(session.getSnapshot().note?.path).toBe("b.md");
    expect(session.getSnapshot().text).toBe("# Second");
  });
});
