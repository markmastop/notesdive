import { useEffect, useRef, useState } from "react";
import { desktop } from "./api";
import type { Project, ProjectEntry, ProjectTodo } from "./projects";
import { remarkableApi } from "./remarkable";
import { allRemarkableResources, remarkableResources, remarkableRoot } from "./remarkableScope";
import { readRmTasks } from "./readRmTasks";
import { parseTodos } from "./todos";

export interface RemarkableScopeData {
  entries: ProjectEntry[]; tasks: ProjectTodo[]; folders: string[];
  warnings: string[]; loading: boolean; tasksLoading: boolean; files: number; readIds: string[];
}
const empty: RemarkableScopeData = { entries: [], tasks: [], folders: [], warnings: [], loading: false, tasksLoading: false, files: 0, readIds: [] };
export function useRemarkableScope(project: Project | undefined, scanTasks: boolean, all = false) {
  const key = JSON.stringify([all, project?.id, project?.remarkableFolders]);
  const [snapshot, setSnapshot] = useState({ key: "", data: empty });
  const [version, setVersion] = useState(0);
  const cache = useRef(new Map<string, { stamp: string; tasks: ProjectTodo[] }>());
  const linked = all || !!project?.remarkableFolders?.length;
  useEffect(() => {
    if (!linked) return;
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener("notesdive-remarkable-changed", refresh);
    return () => window.removeEventListener("notesdive-remarkable-changed", refresh);
  }, [linked]);
  useEffect(() => {
    if ((!project && !all) || !linked || !desktop) return;
    const controller = new AbortController();
    const { signal } = controller;
    let data: RemarkableScopeData = { ...empty, folders: all ? [] : project!.remarkableFolders!.map(remarkableRoot), loading: true };
    const publish = () => { if (!signal.aborted) setSnapshot({ key, data: { ...data } }); };
    publish();
    void (async () => {
      if (!await remarkableApi.status()) {
        cache.current.clear();
        if (all) return;
        throw new Error("Connect reMarkable to read the linked project folders.");
      }
      signal.throwIfAborted();
      const listing = await remarkableApi.list(() => {});
      signal.throwIfAborted();
      const resources = all ? allRemarkableResources(listing.items) : remarkableResources(project!, listing.items);
      data = { ...data, entries: resources.entries, folders: resources.folders, loading: false,
        warnings: [...listing.warnings, ...resources.missing.map((link) => `reMarkable folder ${link.name} is unavailable. Relink it in project settings.`)], tasksLoading: scanTasks };
      publish();
      for (const entry of data.entries) {
        signal.throwIfAborted();
        const item = listing.items.find((item) => item.id === entry.remarkableId)!;
        const stamp = item.revision ?? `${item.modified ?? "unknown"}:${version}`;
        const cached = cache.current.get(item.id);
        if (cached?.stamp === stamp) {
          data.tasks = [...data.tasks, ...cached.tasks.map((task) => ({ ...task, folder: entry.folder, path: entry.path }))];
          data.files++;
          data.readIds = [...data.readIds, item.id];
        } else if (scanTasks) {
          try {
            const detail = await remarkableApi.detail(item.id);
            signal.throwIfAborted();
            const tasks: ProjectTodo[] = [];
            let failed = false;
            for (let page = 0; page < detail.pages.length; page++) {
              signal.throwIfAborted();
              try {
                const asset = await remarkableApi.preview(item.id, page);
                signal.throwIfAborted();
                if (asset.mime !== "application/x-remarkable") throw new Error("Unexpected notebook page format.");
                const rows = await readRmTasks(asset.data, signal);
                for (const row of rows) {
                  const parsed = parseTodos({ path: entry.path, revision: stamp,
                    content: `- [${row.checked ? "x" : " "}] ${row.text.replace(/[\r\n]+/g, " ")}` })[0];
                  if (parsed) tasks.push({ ...parsed, folder: entry.folder, readOnly: true, remarkableId: item.id,
                    page: page + 1, line: row.line, offset: tasks.length });
                }
              } catch (cause) {
                signal.throwIfAborted(); failed = true;
                data.warnings.push(`${entry.name}, page ${page + 1}: ${String(cause)}`);
              }
            }
            if (!failed) {
              cache.current.set(item.id, { stamp, tasks });
              data.readIds = [...data.readIds, item.id];
            }
            data.tasks = [...data.tasks, ...tasks]; data.files++;
          } catch (cause) {
            signal.throwIfAborted(); data.warnings.push(`${entry.name}: ${String(cause)}`);
          }
        }
        publish();
      }
      const ids = new Set(data.entries.map((entry) => entry.remarkableId));
      for (const id of cache.current.keys()) if (!ids.has(id)) cache.current.delete(id);
    })().catch((cause) => { if (!signal.aborted) data.warnings.push(String(cause)); })
      .finally(() => { data.loading = false; data.tasksLoading = false; publish(); });
    return () => controller.abort();
  }, [key, linked, version, scanTasks]);
  return { ...(linked && snapshot.key === key ? snapshot.data : empty), refresh: () => setVersion((n) => n + 1) };
}
