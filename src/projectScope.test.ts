import { describe, expect, it } from "vitest";
import { scopeResources, selectedProject } from "./projectScope";
import { parseTodos } from "./todos";
import type { Project } from "./projects";

const project: Project = { id: "work", name: "Work", color: "sage", description: "", pinned: false,
  archived: false, folders: ["/a/notes", "/b/notes", "/c/notes (1)"], defaultFolder: null };

describe("project scope", () => {
  it("does not scope to missing or archived projects", () => {
    expect(selectedProject({ active: "missing", projects: [project] })).toBeUndefined();
    expect(selectedProject({ active: project.id, projects: [{ ...project, archived: true }] })).toBeUndefined();
    expect(selectedProject({ active: project.id, projects: [project] })).toBe(project);
  });

  it("keeps matching root names, filenames and task offsets distinct", () => {
    const entries = project.folders.map((folder) => ({ folder, path: "nested/Work.md", name: "Work.md", modified: 1, snippet: null }));
    const tasks = project.folders.flatMap((folder) => parseTodos({ path: "nested/Work.md", revision: folder, content: "- [ ] Do the work\n" }).map((task) => ({ ...task, folder })));
    const scoped = scopeResources(project, entries, tasks);
    expect(new Set(scoped.entries.map((entry) => entry.path)).size).toBe(3);
    expect(scoped.tasks.map((task) => task.path)).toEqual(scoped.entries.map((entry) => entry.path));
    for (const [i, entry] of scoped.entries.entries()) {
      expect(scoped.sources.get(entry.path)).toEqual({ folder: project.folders[i], path: "nested/Work.md" });
      expect(scoped.tasks[i].offset).toBe(tasks[i].offset);
      expect(scoped.tasks[i].revision).toBe(project.folders[i]);
    }
  });

  it("keeps empty directories under their own labeled roots", () => {
    const scoped = scopeResources(project, [], [], [], new Map(), project.folders.map((folder) => ({ folder, path: "Empty/Nested" })));
    expect(scoped.directories).toEqual(scoped.folders.map((label) => `${label}/Empty/Nested`));
    expect(new Set(scoped.directories).size).toBe(3);
    expect(scoped.entries).toEqual([]);
  });
});
