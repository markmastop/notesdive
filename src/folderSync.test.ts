import { describe, expect, it } from "vitest";
import { folderSyncLink, folderSyncPaths, folderSyncTargets } from "./folderSync";
import { removeFolder, type Project } from "./projects";

describe("folder sync setup", () => {
  const project: Project = { id: "summa", name: "Summa", description: "", color: "sage", pinned: false, archived: false,
    folders: ["/summa", "/other"], defaultFolder: "/summa", remarkableFolders: [{ id: "cloud", name: "Work" }],
    remarkableSync: [
      { id: "parent", localFolder: "/summa", path: "AIIM", remoteParentId: "cloud", enabled: true },
      { id: "child", localFolder: "/summa", path: "AIIM/Meeting", remoteParentId: "cloud", enabled: false },
    ] };
  it("inherits setup for descendants while keeping other roots and names distinct", () => {
    expect(folderSyncLink(project, "/summa", "AIIM/Meeting")?.id).toBe("parent");
    expect(folderSyncLink(project, "/other", "AIIM")).toBeUndefined();
    expect(folderSyncLink(project, "/summa", "AIIM-other")).toBeUndefined();
    expect(folderSyncPaths(project, new Map([["@Summa", "/summa"]]))).toEqual(new Set(["@Summa/AIIM"]));
  });
  it("maps the actual cloud twin to the same setup by ID, including renamed and duplicate folders", () => {
    const synced: Project = { ...project, remarkableSync: [{ ...project.remarkableSync![0], state: { folders: { AIIM: "twin" }, files: [] } }] };
    const roots = new Map([["@Summa", "/summa"], ["reMarkable · Work", "remarkable:cloud:Work"]]);
    const entries = [
      { folder: "remarkable:cloud:Work", path: "reMarkable · Work/Renamed/Child/note", name: "note", modified: 0, snippet: null, remarkableId: "doc", remarkableFolderIds: ["child", "twin", "cloud"] },
      { folder: "remarkable:cloud:Work", path: "reMarkable · Work/AIIM/note", name: "note", modified: 0, snippet: null, remarkableId: "other-doc", remarkableFolderIds: ["unrelated", "cloud"] },
    ];
    const targets = folderSyncTargets(synced, roots, entries);
    expect(targets.get("reMarkable · Work/Renamed")).toEqual(targets.get("@Summa/AIIM"));
    expect(targets.has("reMarkable · Work/AIIM")).toBe(false);
    expect(targets.has("reMarkable · Work/Renamed/Child")).toBe(false);
    expect(folderSyncTargets({ ...synced, remarkableSync: [{ ...synced.remarkableSync![0], enabled: false }] }, roots, entries).size).toBe(0);
  });
  it("drops setup when the local root is removed", () => {
    expect(removeFolder(project, "/summa").remarkableSync).toEqual([]);
  });
});
