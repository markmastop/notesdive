import { Channel, invoke } from "@tauri-apps/api/core";

export interface RemarkableItem {
  id: string;
  parent: string;
  name: string;
  isFolder: boolean;
  modified: number | null;
  pinned: boolean;
  revision?: string;
}
export interface RemarkableListing { items: RemarkableItem[]; warnings: string[] }
export interface RemarkableProgress { items: RemarkableItem[]; loaded: number; total: number }
export interface RemarkableDetail { fileType: string; pageCount: number | null; orientation: string | null; pages: string[] }
export interface RemarkablePreview { mime: string; data: string | null }
export const remarkableApi = {
  status: () => invoke<boolean>("remarkable_status"),
  pair: (code: string) => invoke<void>("remarkable_pair", { code }),
  disconnect: () => invoke<void>("remarkable_disconnect"),
  list: (progress: (value: RemarkableProgress) => void) => {
    const onProgress = new Channel<RemarkableProgress>();
    onProgress.onmessage = progress;
    return invoke<RemarkableListing>("remarkable_list", { onProgress });
  },
  preview: (id: string, page: number | null) => invoke<RemarkablePreview>("remarkable_preview", { id, page }),
  detail: (id: string) => invoke<RemarkableDetail>("remarkable_detail", { id }),
};
export function remarkablePath(item: RemarkableItem, items: RemarkableItem[]): string {
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  return pathWithIndex(item, byId);
}
function pathWithIndex(item: RemarkableItem, byId: Map<string, RemarkableItem>): string {
  const names = [item.name];
  const seen = new Set([item.id]);
  let parent = item.parent;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const folder = byId.get(parent);
    if (!folder) break;
    names.unshift(folder.name);
    parent = folder.parent;
  }
  return names.join(" / ");
}
export function remarkableFolders(items: RemarkableItem[], expanded?: ReadonlySet<string>): { item: RemarkableItem; depth: number }[] {
  const children = new Map<string, RemarkableItem[]>();
  for (const item of items.filter((entry) => entry.isFolder)) {
    const siblings = children.get(item.parent) ?? [];
    siblings.push(item);
    children.set(item.parent, siblings);
  }
  const result: { item: RemarkableItem; depth: number }[] = [];
  const seen = new Set<string>();
  const stack = (children.get("") ?? []).sort((a, b) => b.name.localeCompare(a.name)).map((item) => ({ item, depth: 0 }));
  while (stack.length) {
    const row = stack.pop()!;
    if (seen.has(row.item.id)) continue;
    seen.add(row.item.id);
    result.push(row);
    if (!expanded || expanded.has(row.item.id)) {
      stack.push(...(children.get(row.item.id) ?? []).sort((a, b) => b.name.localeCompare(a.name)).map((item) => ({ item, depth: row.depth + 1 })));
    }
  }
  return result;
}
export function remarkableRows(items: RemarkableItem[], folder: string | null, query: string, pinned: boolean, sort: "name" | "recent") {
  const term = query.trim().toLocaleLowerCase();
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.filter((item) => {
    if (pinned && !item.pinned) return false;
    if (term) return pathWithIndex(item, byId).toLocaleLowerCase().includes(term);
    return !item.isFolder && (folder === null || item.parent === folder);
  }).sort((a, b) => Number(b.isFolder) - Number(a.isFolder)
    || (sort === "recent" ? (b.modified ?? 0) - (a.modified ?? 0) : 0)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export function remarkableDate(timestamp: number | null) {
  if (!timestamp || !Number.isFinite(timestamp) || Number.isNaN(new Date(timestamp).getTime())) return "Unknown";
  return new Date(timestamp).toLocaleString();
}
