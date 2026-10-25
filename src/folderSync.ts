import type { Project, ProjectEntry } from "./projects";

export function folderSyncLink(project: Project, folder: string, path: string) {
  return project.remarkableSync?.find((link) => link.enabled && link.localFolder === folder && link.path === path)
    ?? project.remarkableSync?.find((link) => link.enabled && link.localFolder === folder
      && (!link.path || path.startsWith(link.path + "/")))
    ?? project.remarkableSync?.find((link) => link.localFolder === folder && link.path === path);
}

export function folderSyncTargets(project: Project | undefined, roots: Map<string, string>, entries: ProjectEntry[] = []) {
  const result = new Map<string, { folder: string; path: string; label: string }>();
  const labels = new Map([...roots].map(([label, folder]) => [folder, label]));
  for (const link of project?.remarkableSync ?? []) {
    if (!link.enabled) continue;
    const label = labels.get(link.localFolder);
    if (!label) continue;
    const localPath = link.path ? `${label}/${link.path}` : label;
    const target = { folder: link.localFolder, path: link.path, label: localPath };
    result.set(localPath, target);
    const twinId = link.state?.folders[link.path];
    if (!twinId) continue;
    // Ancestor IDs are nearest-parent first; match identity, never a folder name.
    for (const entry of entries) {
      const index = entry.remarkableFolderIds?.indexOf(twinId) ?? -1;
      if (!entry.remarkableId || index < 0) continue;
      const parts = entry.path.split("/");
      const twinPath = parts.slice(0, parts.length - 1 - index).join("/");
      if (twinPath) result.set(twinPath, target);
    }
  }
  return result;
}

export function folderSyncPaths(project: Project | undefined, roots: Map<string, string>, entries: ProjectEntry[] = []) {
  return new Set(folderSyncTargets(project, roots, entries).keys());
}
