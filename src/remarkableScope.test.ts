import { describe, expect, it } from "vitest";
import { allRemarkableResources, remarkableResources, remarkableScopeItems } from "./remarkableScope";
import { scopeResources } from "./projectScope";
import type { Project } from "./projects";
import type { RemarkableItem } from "./remarkable";
const item = (id: string, name: string, parent = "", isFolder = false): RemarkableItem => ({ id, name, parent, isFolder, pinned: false, modified: 1 });
const items = [item("work", "Work", "", true), item("meetings", "Meetings", "work", true), item("note", "Notes", "work"),
  item("duplicate", "Notes", "meetings"), item("empty", "Empty", "", true), item("outside", "Private notes"), item("another", "Notes", "work")];
const project: Project = { id: "p", name: "Work", description: "", color: "sage", pinned: false, archived: false,
  folders: ["/local/reMarkable · Work"], defaultFolder: null, remarkableFolders: [{ id: "work", name: "Old name" }] };
describe("linked reMarkable project folders", () => {
  it("includes all descendants by ID and excludes unrelated files and cycles", () => {
    expect(remarkableScopeItems(items, ["work"]).map((row) => row.id)).toEqual(["work", "meetings", "note", "duplicate", "another"]);
    expect(remarkableScopeItems([...items, item("cycle", "Cycle", "cycle", true)], ["missing"])).toEqual([]);
  });
  it("deduplicates overlapping links and keeps repeated names and local paths distinct", () => {
    const resources = remarkableResources({ ...project, remarkableFolders: [...project.remarkableFolders!, { id: "meetings", name: "Meetings" }] }, items);
    expect(resources.entries).toHaveLength(3);
    expect(new Set(resources.entries.map((entry) => entry.path)).size).toBe(3);
    expect(resources.folders).toEqual(["remarkable:work:Work"]);
    const local = { folder: project.folders[0], path: "Notes.rm", name: "Notes", modified: 1, snippet: null };
    const scoped = scopeResources(project, [local, ...resources.entries], [], resources.folders);
    expect(new Set(scoped.entries.map((entry) => entry.path)).size).toBe(4);
    expect(scoped.folders).toEqual(["reMarkable · Work", "reMarkable · Work (1)"]);
  });
  it("preserves empty and missing linked roots and reports missing references", () => {
    const resources = remarkableResources({ ...project, remarkableFolders: [{ id: "empty", name: "Empty" }, { id: "missing", name: "Missing" }] }, items);
    expect(resources.entries).toEqual([]);
    expect(resources.folders).toEqual(["remarkable:empty:Empty", "remarkable:missing:Missing"]);
    expect(resources.missing.map((link) => link.id)).toEqual(["missing"]);
  });
  it("does not suffix a folder when a sibling notebook has the same name", () => {
    const cloud = [item("work", "Work", "", true), item("folder-id", "VDL", "work", true),
      item("notebook-id", "VDL", "work"), item("child-id", "Meeting", "folder-id")];
    const resources = remarkableResources(project, cloud);
    expect(resources.entries.find((entry) => entry.remarkableId === "notebook-id")?.path).toBe("VDL");
    expect(resources.entries.find((entry) => entry.remarkableId === "child-id")?.path).toBe("VDL/Meeting");
  });
  it("uses readable suffixes for duplicate folders, avoiding real names and keeping IDs distinct", () => {
    const cloud = [item("work", "Work", "", true), item("folder-a", "VDL", "work", true),
      item("folder-b", "VDL", "work", true), item("folder-c", "VDL (2)", "work", true),
      item("a", "Meeting", "folder-a"), item("b", "Meeting", "folder-b"), item("c", "Meeting", "folder-c")];
    const resources = remarkableResources(project, cloud);
    expect(resources.entries.map((entry) => [entry.remarkableId, entry.path])).toEqual([
      ["a", "VDL/Meeting"], ["b", "VDL (3)/Meeting"], ["c", "VDL (2)/Meeting"],
    ]);
    expect(remarkableResources(project, [...cloud].reverse()).entries.map((entry) => [entry.remarkableId, entry.path]).sort())
      .toEqual(resources.entries.map((entry) => [entry.remarkableId, entry.path]).sort());
    const scoped = scopeResources(project, resources.entries, [], resources.folders);
    for (const entry of scoped.entries) expect(scoped.sources.get(entry.path)?.path).toBe(
      resources.entries.find((source) => source.remarkableId === entry.remarkableId)?.path);
  });
  it("keeps names distinct when path separators normalize to the same character", () => {
    const cloud = [item("work", "Work", "", true), item("a", "VDL/Notes", "work"), item("b", "VDL⁄Notes", "work")];
    expect(remarkableResources(project, cloud).entries.map((entry) => entry.path)).toEqual(["VDL⁄Notes", "VDL⁄Notes (2)"]);
  });
});

it("the complete cloud view includes top-level notebooks and folders regardless of project links", () => {
  const resources = allRemarkableResources(items);
  expect(resources.entries.map((entry) => entry.remarkableId).sort()).toEqual(["another", "duplicate", "note", "outside"]);
  expect(resources.entries.find((entry) => entry.remarkableId === "outside")?.path).toBe("Private notes");
  expect(resources.entries.find((entry) => entry.remarkableId === "duplicate")?.path).toBe("Work/Meetings/Notes");
  expect(new Set(resources.entries.map((entry) => entry.path)).size).toBe(resources.entries.length);
});
