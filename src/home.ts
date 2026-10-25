import type { Entry, Folder } from "./api";
import {
  projectApi,
  ProjectIndex,
  type Project,
  type ProjectEntry,
  type ProjectTodo,
  type Projects,
} from "./projects";
import type { Todo } from "./todos";

export type HomeEntry = ProjectEntry & { projectIds: string[] };
export type HomeTask = ProjectTodo & { projectIds: string[] };
export type HomeData = {
  entries: HomeEntry[];
  tasks: HomeTask[];
  warnings: string[];
};
export type RecentDocument = { folder: string; path: string; openedAt: number };
const recentKey = "notesdive:recent-documents";
const projectKey = "notesdive:recent-projects";
const normalized = (path: string) =>
  path.replace(/\\/g, "/").replace(/\/$/, "");
const absolute = (folder: string, path: string) =>
  `${normalized(folder)}/${path}`;
const readArray = <T>(key: string): T[] => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};
export const recentDocuments = (): RecentDocument[] =>
  readArray<RecentDocument>(recentKey).filter(
    (item) =>
      item &&
      typeof item.folder === "string" &&
      typeof item.path === "string" &&
      Number.isFinite(item.openedAt),
  );
export function rememberDocument(folder: string, path: string) {
  const next = [
    { folder, path, openedAt: Date.now() },
    ...recentDocuments().filter(
      (item) => absolute(item.folder, item.path) !== absolute(folder, path),
    ),
  ].slice(0, 30);
  try {
    localStorage.setItem(recentKey, JSON.stringify(next));
  } catch {
    /* Browsing still works without history. */
  }
}
export const recentProjects = (): string[] =>
  readArray<string>(projectKey).filter((id) => typeof id === "string");
export function rememberProject(id: string) {
  try {
    localStorage.setItem(
      projectKey,
      JSON.stringify(
        [id, ...recentProjects().filter((other) => other !== id)].slice(0, 20),
      ),
    );
  } catch {
    /* Browsing still works without history. */
  }
}
export function orderedProjects(config: Projects) {
  const recent = recentProjects();
  const rank = (id: string) => {
    const position = recent.indexOf(id);
    return position < 0 ? recent.length : position;
  };
  return config.projects
    .filter((project) => !project.archived)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (a.id === config.active ? -1 : b.id === config.active ? 1 : 0) ||
        rank(a.id) - rank(b.id) ||
        a.name.localeCompare(b.name),
    );
}
export function projectSources(projects: Project[]) {
  const sources = new Map<
    string,
    { folder: string; projectId: string; projectIds: string[] }
  >();
  for (const project of projects)
    for (const folder of project.folders) {
      const key = normalized(folder);
      const existing = sources.get(key);
      if (existing) existing.projectIds.push(project.id);
      else
        sources.set(key, {
          folder,
          projectId: project.id,
          projectIds: [project.id],
        });
    }
  return [...sources.values()];
}
export class HomeIndex {
  private indexes = new Map<string, ProjectIndex>();
  constructor(private library: string | null) {}
  async scan(projects: Project[], signal: AbortSignal): Promise<HomeData> {
    const entries = new Map<string, HomeEntry>();
    const tasks = new Map<string, HomeTask>();
    const warnings: string[] = [];
    for (const source of projectSources(projects)) {
      signal.throwIfAborted();
      const key = `${source.projectId}:${source.folder}`;
      let index = this.indexes.get(key);
      if (!index) {
        index = new ProjectIndex(
          {
            list: (id, folder, query) =>
              projectApi.list(id, folder, query, this.library),
            read: (id, folder, path) =>
              projectApi.read(id, folder, path, this.library),
          },
          source.projectId,
        );
        this.indexes.set(key, index);
      }
      const result = await index.scan([source.folder], "", true, signal);
      for (const entry of result.entries) {
        const id = absolute(entry.folder, entry.path);
        const existing = entries.get(id);
        if (existing)
          existing.projectIds = [
            ...new Set([...existing.projectIds, ...source.projectIds]),
          ];
        else entries.set(id, { ...entry, projectIds: [...source.projectIds] });
      }
      for (const task of result.tasks) {
        const id = `${absolute(task.folder, task.path)}:${task.offset}`;
        const existing = tasks.get(id);
        if (existing)
          existing.projectIds = [
            ...new Set([...existing.projectIds, ...source.projectIds]),
          ];
        else tasks.set(id, { ...task, projectIds: [...source.projectIds] });
      }
      warnings.push(...result.warnings);
    }
    return {
      entries: [...entries.values()].sort(
        (a, b) => b.modified - a.modified || a.name.localeCompare(b.name),
      ),
      tasks: [...tasks.values()],
      warnings,
    };
  }
  async search(
    projects: Project[],
    query: string,
    signal: AbortSignal,
  ): Promise<HomeEntry[]> {
    const entries = new Map<string, HomeEntry>();
    for (const source of projectSources(projects)) {
      signal.throwIfAborted();
      try {
        const result = await projectApi.list(
          source.projectId,
          source.folder,
          query,
          this.library,
        );
        for (const entry of result.entries) {
          const id = absolute(source.folder, entry.path);
          const existing = entries.get(id);
          if (existing)
            existing.projectIds = [
              ...new Set([...existing.projectIds, ...source.projectIds]),
            ];
          else
            entries.set(id, {
              ...entry,
              folder: source.folder,
              projectIds: [...source.projectIds],
            });
        }
      } catch (error) {
        signal.throwIfAborted(); /* Other project roots remain searchable. */
      }
    }
    return [...entries.values()].sort(
      (a, b) => b.modified - a.modified || a.name.localeCompare(b.name),
    );
  }
}
export function includeCurrentFolder(
  data: HomeData,
  folder: Folder | null,
  entries: Entry[],
  tasks: Todo[],
): HomeData {
  if (!folder) return data;
  const files = new Map(
    data.entries.map((entry) => [absolute(entry.folder, entry.path), entry]),
  );
  const todos = new Map(
    data.tasks.map((task) => [
      `${absolute(task.folder, task.path)}:${task.offset}`,
      task,
    ]),
  );
  for (const entry of entries) {
    const id = absolute(folder.path, entry.path);
    const existing = files.get(id);
    files.set(id, {
      ...entry,
      folder: folder.path,
      projectIds: existing?.projectIds ?? [],
    });
  }
  for (const task of tasks) {
    const id = `${absolute(folder.path, task.path)}:${task.offset}`;
    const existing = todos.get(id);
    todos.set(id, {
      ...task,
      folder: folder.path,
      projectIds: existing?.projectIds ?? [],
    });
  }
  return {
    entries: [...files.values()].sort(
      (a, b) => b.modified - a.modified || a.name.localeCompare(b.name),
    ),
    tasks: [...todos.values()],
    warnings: data.warnings,
  };
}
export function recentEntries(entries: HomeEntry[], history: RecentDocument[]) {
  const byPath = new Map(
    entries.map((entry) => [absolute(entry.folder, entry.path), entry]),
  );
  return history
    .map((item) => byPath.get(absolute(item.folder, item.path)))
    .filter((entry): entry is HomeEntry => !!entry);
}
