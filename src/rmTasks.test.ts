import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { extractRmTasks, extractRmDocumentTasks } from "./rmTasks";
import { toggleTodo } from "./todos";
import type { RmDocument } from "remarkable-rm";
const fixture = (v: number) => new Uint8Array(readFileSync(new URL(`../tests/fixtures/remarkable/v${v}-sample.rm`, import.meta.url)));
describe("reMarkable checkbox tasks", () => {
  it("reads actual v6 typed checkboxes, their checked state and formatted text", () => {
    expect(extractRmTasks(fixture(6)).map(({ text, checked }) => ({ text, checked }))).toEqual([
      { text: "Checkbox", checked: false }, { text: "Checked and bold, italic", checked: true },
    ]);
    expect(extractRmTasks(fixture(5))).toEqual([]);
  });
  it("ignores handwritten marks and ordinary lists, and traverses visible text groups", () => {
    const text = { type: "text" as const, position: { x: 0, y: 0 }, width: 100, paragraphs: [
      { style: "checkbox" as const, spans: [{ text: "Do the work" }] }, { style: "bullet" as const, spans: [{ text: "Not a task" }] },
    ] };
    const doc: RmDocument = { version: 6, pages: [{ layers: [
      { id: "visible", visible: true, items: [{ type: "group", items: [text] }] },
      { id: "hidden", visible: false, items: [text] },
    ] }] };
    expect(extractRmDocumentTasks(doc).map((task) => task.text)).toEqual(["Do the work"]);
  });
  it("never reads or writes a local note to toggle a read-only cloud task", async () => {
    const api = { read: vi.fn(), save: vi.fn() };
    await expect(toggleTodo(api, "remarkable:work:Work", { path: "Notes.rm", line: 1, offset: 0, text: "Do it", checked: false, revision: "x", readOnly: true })).rejects.toThrow("read-only");
    expect(api.read).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
  });
});
