import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeIndex, includeCurrentFolder, projectSources } from "./home";
import { projectApi, type Project } from "./projects";

const project = (id: string, folders: string[]): Project => ({
  id,
  name: id,
  description: "",
  color: "sage",
  pinned: false,
  archived: false,
  folders,
  defaultFolder: folders[0] ?? null,
});

afterEach(() => vi.restoreAllMocks());

describe("Home across projects", () => {
  it("shows a shared folder once with both project associations", async () => {
    const list = vi.spyOn(projectApi, "list").mockImplementation(async () => ({
      entries: [
        { path: "Plan.md", name: "Plan.md", modified: 1, snippet: null },
      ],
      warnings: [],
    }));
    vi.spyOn(projectApi, "read").mockImplementation(
      async (_id, _folder, path) => ({
        path,
        content: "# Plan\n\n- [ ] Review the draft\n",
        revision: "1",
      }),
    );
    const projects = [project("a", ["/shared"]), project("b", ["/shared"])];
    const index = new HomeIndex(null);
    const data = await index.scan(projects, new AbortController().signal);
    expect(projectSources(projects)).toHaveLength(1);
    expect(list).toHaveBeenCalledWith("a", "/shared", "", null);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].projectIds).toEqual(["a", "b"]);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].projectIds).toEqual(["a", "b"]);
  });

  it("keeps same-named files in different folders distinct", async () => {
    vi.spyOn(projectApi, "list").mockImplementation(async () => ({
      entries: [
        { path: "Notes.md", name: "Notes.md", modified: 1, snippet: null },
      ],
      warnings: [],
    }));
    vi.spyOn(projectApi, "read").mockImplementation(
      async (_id, _folder, path) => ({
        path,
        content: "- [ ] Follow up\n",
        revision: "1",
      }),
    );
    const data = await new HomeIndex(null).scan(
      [project("a", ["/one"]), project("b", ["/two"])],
      new AbortController().signal,
    );
    expect(data.entries.map((entry) => entry.folder).sort()).toEqual([
      "/one",
      "/two",
    ]);
    expect(data.tasks.map((task) => task.folder).sort()).toEqual([
      "/one",
      "/two",
    ]);
    const merged = includeCurrentFolder(
      data,
      { path: "/one", name: "One" },
      [{ path: "Notes.md", name: "Notes.md", modified: 2, snippet: null }],
      [],
    );
    expect(merged.entries).toHaveLength(2);
    expect(
      merged.entries.find((entry) => entry.folder === "/one")?.projectIds,
    ).toEqual(["a"]);
  });
});
