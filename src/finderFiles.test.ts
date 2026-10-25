import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotesApi } from "./api";
import { DocumentSession } from "./session";
import { watchFinderFiles, type FinderBridge } from "./finderFiles";

const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach((stop) => stop()); });
function setup(restored: Promise<unknown> = Promise.resolve()) {
  const api = {
    restore: async () => ({ path: "/notes", name: "Notes" }),
    read: async (_folder: string, path: string) => ({ path, content: "Original", revision: "v1" }),
    save: vi.fn(async (_folder, note) => ({ ...note, revision: "v2" })),
  } as unknown as NotesApi;
  const session = new DocumentSession(api, 60_000);
  let notify = () => {};
  let pending: { id: string }[] = [];
  const source: FinderBridge = {
    listen: vi.fn(async (ready) => { notify = ready; return vi.fn(); }),
    pending: vi.fn(async () => pending),
    open: vi.fn(async (id) => ({ folder: { path: "/outside", name: "Outside" }, note: { path: `${id}.md`, content: `# ${id}`, revision: id } })),
  };
  const opened = vi.fn();
  stops.push(watchFinderFiles(session, restored, opened, source));
  return { api, session, source, opened, send: (...ids: string[]) => { pending = ids.map((id) => ({ id })); notify(); } };
}

describe("Finder open requests", () => {
  it("retains cold-start requests until restoration and opens a duplicate event once", async () => {
    let finish!: () => void;
    const { session, source, send, opened } = setup(new Promise<void>((resolve) => { finish = resolve; }));
    send("Startup");
    await Promise.resolve();
    expect(source.open).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    send("Startup");
    await Promise.resolve();
    expect(source.open).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().note?.path).toBe("Startup.md");
  });

  it("saves the current draft before opening another file and serializes multiple files", async () => {
    const { session, api, source, send, opened } = setup();
    await session.restore();
    await session.open("existing.md");
    session.edit("Keep my draft");
    send("First", "Second");
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(2));
    expect(api.save).toHaveBeenCalledWith("/notes", expect.objectContaining({ content: "Keep my draft" }));
    expect(vi.mocked(api.save).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(source.open).mock.invocationCallOrder[0]);
    expect(session.getSnapshot().text).toBe("# Second");
    session.edit("Edited external file");
    await session.save();
    expect(api.save).toHaveBeenLastCalledWith("/outside", expect.objectContaining({ path: "Second.md", content: "Edited external file" }));
  });

  it("waits for another editor transition before handling a warm event", async () => {
    const { session, source, send, opened } = setup();
    let finish!: () => void;
    const transition = session.close(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    send("WhileBusy");
    await Promise.resolve();
    expect(source.open).not.toHaveBeenCalled();
    finish();
    await transition;
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  });

  it("preserves a draft and blocks the whole batch when saving fails", async () => {
    const { session, api, source, send } = setup();
    await session.restore();
    await session.open("existing.md");
    session.edit("Unsaved draft");
    vi.mocked(api.save).mockRejectedValue("Read-only volume");
    send("First", "Second");
    await vi.waitFor(() => expect(session.getSnapshot().error).toContain("Read-only volume"));
    expect(source.open).not.toHaveBeenCalled();
    expect(session.getSnapshot().text).toBe("Unsaved draft");
    expect(session.getSnapshot().note?.path).toBe("existing.md");
  });

  it("keeps the previous document when the requested file is unavailable", async () => {
    const { session, source, send } = setup();
    await session.restore();
    await session.open("existing.md");
    vi.mocked(source.open).mockRejectedValue("Cannot open note: file missing");
    send("Missing");
    await vi.waitFor(() => expect(session.getSnapshot().error).toContain("file missing"));
    expect(session.getSnapshot().folder?.path).toBe("/notes");
    expect(session.getSnapshot().note?.path).toBe("existing.md");
  });
});
