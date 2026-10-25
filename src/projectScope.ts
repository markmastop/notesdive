import { folderName, type Project, type ProjectEntry, type Projects, type ProjectTodo } from "./projects";

export const selectedProject = (config: Projects) =>
  config.projects.find((project) => project.id === config.active && !project.archived);

// Browser paths include the root label; source paths remain relative to that root.
// This keeps equal filenames in different linked folders separate in Files and Todos.
export function scopeResources(project: Project, entries: ProjectEntry[], tasks: ProjectTodo[], cloudFolders: string[] = [], folderLabels = new Map<string, string>(), directories: { folder: string; path: string }[] = []) {
  const labelFor = (folder: string) => folderLabels.get(folder) ?? (folder.startsWith("remarkable:") ? folderName(folder) : /\/projects\/[^/]+$/.test(folder.replace(/\\/g, "/")) ? "Project folder" : folderName(folder));
  const labels = new Map<string, string>();
  const reserved = new Set([...project.folders, ...cloudFolders].map(labelFor));
  const used = new Set<string>();
  for (const folder of [...project.folders, ...cloudFolders]) {
    const name = labelFor(folder);
    let label = name;
    let suffix = 1;
    while (used.has(label) || (label !== name && reserved.has(label))) {
      label = `${name} (${suffix++})`;
    }
    labels.set(folder, label);
    used.add(label);
  }
  const sources = new Map<string, { folder: string; path: string }>();
  const pathFor = (source: { folder: string; path: string }) => {
    const path = `${labels.get(source.folder) ?? folderName(source.folder)}/${source.path}`;
    sources.set(path, { folder: source.folder, path: source.path });
    return path;
  };
  return {
    folders: [...labels.values()],
    directories: directories.map(({ folder, path }) => `${labels.get(folder) ?? folderName(folder)}/${path}`),
    rootFolders: new Map([...labels].map(([folder, label]) => [label, folder])),
    entries: entries.map((entry) => ({ ...entry, path: pathFor(entry) })),
    tasks: tasks.map((task) => ({ ...task, path: pathFor(task) })),
    sources,
  };
}
