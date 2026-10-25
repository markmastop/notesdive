import { describe, expect, it } from "vitest";
import { remarkableDate, remarkableFolders, remarkablePath, remarkableRows, type RemarkableItem } from "./remarkable";
const item = (id: string, name: string, parent = "", isFolder = false, pinned = false): RemarkableItem => ({ id, name, parent, isFolder, pinned, modified: null });
const items = [item("a", "Work", "", true), item("b", "Meetings", "a", true), item("empty", "Empty", "", true), item("n1", "Notes", "a"), item("n2", "Notes", "b", false, true), item("root", "Inbox")];
describe("reMarkable browsing", () => {
  it("preserves empty folders and duplicate notebook names without mixing their IDs", () => {
    expect(remarkableFolders(items).map(({ item, depth }) => [item.id, depth])).toEqual([["empty", 0], ["a", 0], ["b", 1]]);
    expect(remarkableRows(items, "a", "", false, "name").map((item) => item.id)).toEqual(["n1"]);
    expect(remarkableRows(items, "", "", false, "name").map((item) => item.id)).toEqual(["root"]);
  });
  it("searches names and full paths across the library and combines pinned filtering", () => {
    expect(remarkableRows(items, "empty", "meetings", false, "name").map((item) => item.id)).toEqual(["b", "n2"]);
    expect(remarkableRows(items, null, "notes", true, "recent").map((item) => item.id)).toEqual(["n2"]);
    expect(remarkableRows(items, null, "", false, "name")).toHaveLength(3);
    expect(remarkablePath(items[4], items)).toBe("Work / Meetings / Notes");
  });
  it("does not hang on broken ancestry and tolerates invalid dates", () => {
    const cyclic = [item("a", "A", "b", true), item("b", "B", "a", true)];
    expect(remarkablePath(cyclic[0], cyclic)).toBe("B / A");
    expect(remarkableFolders(cyclic)).toEqual([]);
    expect(remarkableDate(1e30)).toBe("Unknown");
    expect(remarkableDate(null)).toBe("Unknown");
  });
});
