import type { Project, ProjectEntry, RemarkableFolderLink } from "./projects";
import type { RemarkableItem } from "./remarkable";

export const remarkableRoot = (link: RemarkableFolderLink) => `remarkable:${link.id}:${link.name}`;

/** Match by stable cloud IDs, including descendants; never leak unrelated folders. */
export function remarkableScopeItems(items: RemarkableItem[], roots: string[]) {
  const allowed = new Set(roots);
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.filter((item) => {
    const seen = new Set<string>();
    let current: RemarkableItem | undefined = item;
    while (current && !seen.has(current.id)) {
      if (allowed.has(current.id) && current.isFolder) return true;
      seen.add(current.id);
      current = byId.get(current.parent);
    }
    return false;
  });
}

export function remarkableResources(project: Project, items: RemarkableItem[]) {
  const links = project.remarkableFolders ?? [];
  const byId = new Map(items.map((item) => [item.id, item]));
  // A linked ancestor owns documents in overlapping linked folders.
  const roots = links.filter((link) => !links.some((other) => other.id !== link.id
    && remarkableScopeItems(items, [other.id]).some((item) => item.id === link.id)));
  const scoped = remarkableScopeItems(items, roots.map((link) => link.id));
  const safeName = (item: RemarkableItem) => {
    const name = item.name.replace(/[\\/]/g, "⁄");
    return !name || name === "." || name === ".." ? "Untitled" : name;
  };
  // Folder names and document names occupy separate namespaces. Keep cloud IDs
  // in remarkableId; only duplicate siblings of the same kind need a suffix.
  const siblings = new Map<string, RemarkableItem[]>();
  for (const item of items) {
    const key = JSON.stringify([item.parent, item.isFolder]);
    const group = siblings.get(key) ?? [];
    group.push(item);
    siblings.set(key, group);
  }
  const segments = new Map<string, string>();
  for (const group of siblings.values()) {
    const reserved = new Set(group.map(safeName));
    const used = new Set<string>();
    for (const item of [...group].sort((a, b) => a.id.localeCompare(b.id))) {
      const name = safeName(item);
      let label = name;
      let suffix = 2;
      while (used.has(label) || (label !== name && reserved.has(label))) label = `${name} (${suffix++})`;
      segments.set(item.id, label);
      used.add(label);
    }
  }
  const segment = (item: RemarkableItem) => segments.get(item.id)!;
  const entries: ProjectEntry[] = [];
  const folders = new Set(roots.map((root) => remarkableRoot({ ...root, name: byId.get(root.id)?.name ?? root.name })));
  const missing = links.filter((link) => !byId.get(link.id)?.isFolder);
  for (const item of scoped.filter((item) => !item.isFolder)) {
    const parts = [segment(item)];
    const ancestors: string[] = [];
    let parent = byId.get(item.parent);
    while (parent && !roots.some((link) => link.id === parent!.id)) {
      ancestors.push(parent.id);
      parts.unshift(segment(parent));
      parent = byId.get(parent.parent);
    }
    const root = roots.find((link) => link.id === parent?.id);
    if (!root) continue;
    ancestors.push(root.id);
    const currentRoot = { ...root, name: byId.get(root.id)?.name ?? root.name };
    const folder = remarkableRoot(currentRoot);
    folders.delete(remarkableRoot(root)); folders.add(folder);
    entries.push({ folder, path: parts.join("/"), name: item.name,
      modified: item.modified ?? 0, snippet: "reMarkable · Read only", remarkableId: item.id, remarkableFolderIds: ancestors });
  }
  return { entries, folders: [...folders], missing };
}

/** A synthetic cloud root includes top-level documents as well as every folder. */
export function allRemarkableResources(items: RemarkableItem[]) {
  const root = "notesdive-cloud-root";
  const project: Project = { id: "all-work", name: "All work", color: "sage", description: "", pinned: false,
    archived: false, folders: [], defaultFolder: null, remarkableFolders: [{ id: root, name: "My files" }] };
  const ids = new Set(items.map((item) => item.id));
  return remarkableResources(project, [
    { id: root, name: "My files", parent: "", isFolder: true, pinned: false, modified: 0 },
    ...items.map((item) => ({ ...item, parent: ids.has(item.parent) ? item.parent : root })),
  ]);
}
