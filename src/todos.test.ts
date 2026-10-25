import { describe, expect, it, vi } from "vitest";
import { compareTodoUrgency, parseTodos, TodoIndex, toggleTodo } from "./todos";
const note = (content: string) => ({
  path: "nested/Tasks.md",
  content,
  revision: "v1",
});
describe("Markdown tasks", () => {
  it("finds nested, quoted, ordered and uppercase tasks but ignores code, HTML and metadata", () => {
    const tasks = parseTodos(
      note(
        "---\ntitle: Tasks\nexample: |\n  - [ ] metadata\n---\n\n- [ ] **First** task\n  - [x] Nested\n\n1. [X] Ordered\n\n> - [ ] Quoted\n\n```md\n- [ ] Fenced\n```\n\n    - [ ] Indented code\n\n<div>\n- [ ] HTML\n</div>\n\n- Not a task\n\n  [ ] A second paragraph\n",
      ),
    );
    expect(tasks.map((t) => [t.text, t.checked])).toEqual([
      ["First task", false],
      ["Nested", true],
      ["Ordered", true],
      ["Quoted", false],
    ]);
  });
  it("preserves BOM, CRLF, Unicode and all bytes other than the marker when toggled", async () => {
    const source = note(
      "\uFEFF# Café 🌱\r\n\r\n- [ ] **Read** [the plan](https://example.com)\r\n",
    );
    const task = parseTodos(source)[0];
    expect(task.line).toBe(3);
    expect(task.text).toBe("Read the plan");
    const save = vi.fn().mockResolvedValue(source);
    await toggleTodo(
      { read: vi.fn().mockResolvedValue(source), save },
      "/notes",
      task,
    );
    expect(save.mock.calls[0][1].content).toBe(
      source.content.replace("[ ]", "[x]"),
    );
  });
  it("reads due dates, start dates, priorities and tags without changing Markdown", async () => {
    const source = note("- [ ] Review proposal due:2026-10-05 start:2026-10-02 priority:high #work #review\n- [ ] Fix calendar due:2026-02-30 priority:urgent\n");
    const [first, invalid] = parseTodos(source);
    expect(first).toMatchObject({ text: "Review proposal", due: "2026-10-05", start: "2026-10-02", priority: "high", tags: ["work", "review"] });
    expect(invalid).toMatchObject({ text: "Fix calendar due:2026-02-30 priority:urgent" });
    const save = vi.fn().mockResolvedValue(source);
    await toggleTodo({ read: vi.fn().mockResolvedValue(source), save }, "/notes", first);
    expect(save.mock.calls[0][1].content).toBe(source.content.replace("[ ]", "[x]"));
  });
  it("reads Dataview-style task fields and leaves invalid fields visible", () => {
    const [task, invalid] = parseTodos(note("- [ ] Review proposal [assignee:: @alex] [start:: 2026-10-02] [due:: 2026-10-05] [priority:: urgent] [stage:: doing] #work\n- [ ] Fix calendar [due:: 2026-02-30] [priority:: unknown] [assignee:: Alex]\n"));
    expect(task).toMatchObject({ text: "Review proposal", assignee: "@alex", start: "2026-10-02", due: "2026-10-05", priority: "urgent", stage: "doing", tags: ["work"] });
    expect(invalid.text).toBe("Fix calendar [due:: 2026-02-30] [priority:: unknown] [assignee:: Alex]");
    expect(invalid.due).toBeUndefined();
  });
  it("orders dated tasks before undated tasks and uses priority as a tie-breaker", () => {
    const tasks = parseTodos(note("- [ ] Later due:2026-10-10 priority:high\n- [ ] Earlier due:2026-10-05 priority:low\n- [ ] Earlier urgent due:2026-10-05 priority:high\n- [ ] Unscheduled priority:high\n"));
    expect(tasks.sort(compareTodoUrgency).map((task) => task.text)).toEqual(["Earlier urgent", "Earlier", "Later", "Unscheduled"]);
  });
  it("does not treat inline code examples as task metadata", () => {
    const [task] = parseTodos(note("- [ ] Document `due:2026-10-05` and `priority:high`\n"));
    expect(task.text).toBe("Document due:2026-10-05 and priority:high");
    expect(task.due).toBeUndefined();
    expect(task.priority).toBeUndefined();
  });
  it("rejects a stale task instead of editing a different line", async () => {
    const source = note("- [ ] One\n");
    const save = vi.fn();
    await expect(
      toggleTodo(
        {
          read: vi.fn().mockResolvedValue({ ...source, revision: "v2" }),
          save,
        },
        "/notes",
        parseTodos(source)[0],
      ),
    ).rejects.toThrow("changed");
    expect(save).not.toHaveBeenCalled();
  });
  it("reuses unchanged files, reads watcher-invalidated files even with identical timestamps, and removes deleted tasks", async () => {
    let entries = ["a.md", "nested/b.md"].map((path) => ({
      path,
      name: path,
      modified: 1,
      snippet: null,
    }));
    const read = vi.fn(async (_folder: string, path: string) => ({
      path,
      content: "- [ ] Task",
      revision: "1",
    }));
    const api = { read, list: vi.fn(async () => ({ entries, warnings: [] })) };
    const index = new TodoIndex(api);
    expect((await index.scan("/notes")).tasks).toHaveLength(2);
    await index.scan("/notes");
    expect(read).toHaveBeenCalledTimes(2);
    await index.scan("/notes", false, ["/notes/nested/b.md"]);
    expect(read).toHaveBeenCalledTimes(3);
    await index.scan("/notes", false, ["/notes/nested"]);
    expect(read).toHaveBeenCalledTimes(4);
    entries = entries.slice(0, 1);
    expect((await index.scan("/notes")).tasks.map((t) => t.path)).toEqual([
      "a.md",
    ]);
    await index.scan("/notes", true);
    expect(read).toHaveBeenCalledTimes(5);
  });
  it("reports unreadable notes and retries them without keeping stale tasks", async () => {
    const api = {
      list: vi.fn(async () => ({
        entries: [{ path: "a.md", name: "a.md", modified: 1, snippet: null }],
        warnings: [],
      })),
      read: vi
        .fn()
        .mockRejectedValueOnce("Unreadable")
        .mockResolvedValue(note("- [ ] Recovered")),
    };
    const index = new TodoIndex(api);
    expect((await index.scan("/notes")).warnings).toEqual(["a.md: Unreadable"]);
    expect((await index.scan("/notes")).tasks).toHaveLength(1);
  });
  it("does not read PDFs or images while indexing Markdown tasks", async () => {
    const read = vi.fn(async () => note("- [ ] One task"));
    const index = new TodoIndex({
      read,
      list: async () => ({
        entries: ["tasks.md", "report.pdf", "diagram.svg", "photo.jpg"].map((path) => ({ path, name: path, modified: 1, snippet: null })),
        warnings: [],
      }),
    });
    const result = await index.scan("/notes");
    expect(result.files).toBe(1);
    expect(result.tasks).toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith("/notes", "tasks.md");
  });
});

it("invalidates Windows watcher paths independently of timestamps", async () => {
  const read = vi.fn(async () => note("- [ ] Windows task"));
  const index = new TodoIndex({
    read,
    list: async () => ({
      entries: [
        {
          path: "nested/Tasks.md",
          name: "Tasks.md",
          modified: 1,
          snippet: null,
        },
      ],
      warnings: [],
    }),
  });
  await index.scan("C:\\Notes");
  await index.scan("C:\\Notes", false, ["C:\\Notes\\nested\\Tasks.md"]);
  expect(read).toHaveBeenCalledTimes(2);
});
