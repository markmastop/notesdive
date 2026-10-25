import { describe, expect, it } from "vitest";
import {
  ProjectIndex,
  parseProjectLinks,
  removeFolder,
  resourceKey,
  type Project,
} from "./projects";

describe("project aggregation", () => {
  it("refreshes empty directories independently of document search and cached tasks", async () => {
    let directories = ["Empty/Nested"];
    const index = new ProjectIndex({
      list: async (_id, _folder, query) => ({ entries: [], directories: query ? [] : directories, warnings: [] }),
      read: async () => { throw Error("Empty folders have no documents"); },
    }, "research");
    const scan = () => index.scan(["/a", "/b"], "search", false, new AbortController().signal);
    expect((await scan()).directories).toEqual([
      { folder: "/a", path: "Empty/Nested" }, { folder: "/b", path: "Empty/Nested" },
    ]);
    directories = ["Renamed"];
    expect((await scan()).directories).toEqual([
      { folder: "/a", path: "Renamed" }, { folder: "/b", path: "Renamed" },
    ]);
    directories = [];
    expect((await scan()).directories).toEqual([]);
  });
  it("extracts web references while ignoring metadata, code and unsafe destinations", () => {
    const links = parseProjectLinks({
      path: "Links.md",
      revision: "1",
      content:
        "---\nsource: https://hidden.example\n---\n[**Project** board](https://board.example)\nhttps://docs.example\n[Duplicate](https://board.example)\n[Local](notes.md)\n[Email](mailto:person@example.com)\n[Unsafe](javascript:alert(1))\n`https://code.example`\n```md\n[Example](https://example.example)\n```",
    });
    expect(links).toEqual([
      {
        path: "Links.md",
        label: "Project board",
        url: "https://board.example",
      },
      {
        path: "Links.md",
        label: "https://docs.example",
        url: "https://docs.example",
      },
    ]);
  });
  it("keeps links searchable independently of file matches and drops removed link files", async () => {
    let exists = true;
    const index = new ProjectIndex(
      {
        list: async (_id, folder, query) => ({
          entries:
            exists && !query
              ? [
                  {
                    path: folder === "/a" ? "nested/Links.md" : "Links.md",
                    name: "Links.md",
                    modified: 1,
                    snippet: null,
                  },
                ]
              : [],
          warnings: [],
        }),
        read: async (_id, _folder, path) => ({
          path,
          revision: "1",
          content: "[Planning](https://planning.example)",
        }),
      },
      "project",
    );
    const result = await index.scan(
      ["/a", "/a/nested"],
      "planning",
      true,
      new AbortController().signal,
    );
    expect(result.entries).toHaveLength(0);
    expect(result.inventory).toHaveLength(1);
    expect(result.linkFiles).toHaveLength(1);
    expect(result.links).toEqual([
      {
        folder: "/a",
        path: "nested/Links.md",
        label: "Planning",
        url: "https://planning.example",
      },
    ]);
    exists = false;
    const removed = await index.scan(
      ["/a"],
      "",
      true,
      new AbortController().signal,
    );
    expect(removed.linkFiles).toHaveLength(0);
    expect(removed.links).toHaveLength(0);
  });
  it("keeps identical relative filenames distinct and tolerates an offline root", async () => {
    const index = new ProjectIndex(
      {
        list: async (_id, folder) => {
          if (folder === "/offline") throw new Error("Disconnected disk");
          return {
            entries: [
              {
                path: "notes.md",
                name: "notes.md",
                modified: 1,
                snippet: null,
              },
            ],
            warnings: [],
          };
        },
        read: async (_id, folder, path) => ({
          path,
          content: `- [ ] From ${folder}`,
          revision: folder,
        }),
      },
      "research",
    );
    const result = await index.scan(
      ["/a", "/offline", "/b"],
      "",
      true,
      new AbortController().signal,
    );
    expect(result.entries.map((e) => resourceKey(e.folder, e.path))).toEqual([
      resourceKey("/a", "notes.md"),
      resourceKey("/b", "notes.md"),
    ]);
    expect(result.tasks.map((t) => t.folder)).toEqual(["/a", "/b"]);
    expect(result.unavailable).toEqual(["/offline"]);
    expect(result.warnings[0]).toContain("Disconnected disk");
  });
  it("does not double-count a file exposed through overlapping roots", async () => {
    const index = new ProjectIndex(
      {
        list: async (_id, folder) => ({
          entries: [
            {
              path: folder === "/a" ? "nested/notes.md" : "notes.md",
              name: "notes.md",
              modified: 1,
              snippet: null,
            },
          ],
          warnings: [],
        }),
        read: async (_id, _folder, path) => ({
          path,
          content: "- [ ] One task",
          revision: "same",
        }),
      },
      "research",
    );
    const result = await index.scan(
      ["/a", "/a/nested"],
      "",
      true,
      new AbortController().signal,
    );
    expect(result.entries).toHaveLength(1);
    expect(result.inventory).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
  });
  it("cancels obsolete scans instead of treating cancellation as an offline folder", async () => {
    const controller = new AbortController();
    const index = new ProjectIndex(
      {
        list: async () => {
          controller.abort();
          return { entries: [], warnings: [] };
        },
        read: async () => {
          throw new Error("unexpected read");
        },
      },
      "research",
    );
    await expect(
      index.scan(["/a"], "", true, controller.signal),
    ).rejects.toThrow();
  });
  it("reassigns the default when detaching it without mutating the saved project", () => {
    const project: Project = {
      id: "one",
      name: "One",
      description: "",
      color: "sage",
      pinned: false,
      archived: false,
      folders: ["/a", "/b"],
      defaultFolder: "/a",
    };
    const next = removeFolder(project, "/a");
    expect(next.folders).toEqual(["/b"]);
    expect(next.defaultFolder).toBe("/b");
    expect(project.folders).toEqual(["/a", "/b"]);
    expect(removeFolder(next, "/b").defaultFolder).toBeNull();
  });
});
