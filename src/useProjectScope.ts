import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { desktop, knownFolderApi } from "./api";
import { ProjectIndex, projectApi, type Project } from "./projects";

type Data = Awaited<ReturnType<ProjectIndex["scan"]>>;
const empty: Data = { entries: [], inventory: [], directories: [], tasks: [], links: [], linkFiles: [], warnings: [], unavailable: [] };

export function useProjectScope(project: Project | undefined, library: string | null, query: string, revision?: string, all = false) {
  const key = JSON.stringify([library, all, project?.id, project?.folders]);
  const [snapshot, setSnapshot] = useState<{ key: string; data: Data; signature: string } | null>(null);
  const [status, setStatus] = useState({ key: "", loading: false, error: "" });
  const [version, setVersion] = useState({ value: 0, force: true });
  const previousRevision = useRef(revision);
  const scanning = useRef(false);
  const index = useMemo(() => project ? new ProjectIndex({
    list: (id, folder, search) => all ? knownFolderApi.list(folder, search) : projectApi.list(id, folder, search, library),
    read: (id, folder, path) => all ? knownFolderApi.read(folder, path) : projectApi.read(id, folder, path, library),
  }, project.id) : null, [key]);
  const refresh = useCallback((force = true) => setVersion((previous) => ({ value: previous.value + 1, force })), []);
  useEffect(() => {
    if (!project || !index) return;
    const controller = new AbortController();
    const force = version.force || previousRevision.current !== revision;
    scanning.current = true;
    // Keep the last completed snapshot usable during background checks.
    setStatus((previous) => previous.key === key && !previous.loading && !previous.error
      ? previous : { key, loading: true, error: "" });
    const timer = setTimeout(() => {
      void index.scan(project.folders, query, force, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            previousRevision.current = revision;
            const signature = JSON.stringify(data);
            setSnapshot((previous) => previous?.key === key && previous.signature === signature
              ? previous : { key, data, signature });
            setStatus((previous) => previous.key === key && !previous.loading && !previous.error
              ? previous : { key, loading: false, error: "" });
          }
        })
        .catch((error) => {
          if (!controller.signal.aborted) setStatus({ key, loading: false, error: String(error) });
        }).finally(() => { if (!controller.signal.aborted) scanning.current = false; });
    }, query ? 220 : 0);
    return () => { clearTimeout(timer); controller.abort(); scanning.current = false; };
  }, [key, query, version, revision]);
  useEffect(() => {
    if (!project) return;
    let timer: ReturnType<typeof setTimeout>;
    // The watcher emits both events for one change; batch these and save bursts.
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refresh(), 180);
    };
    const interval = setInterval(() => { if (!document.hidden && !scanning.current) refresh(false); }, 15000);
    window.addEventListener("focus", update);
    window.addEventListener("document-files-changed", update);
    const stops = desktop ? [
      listen<string>("notes-changed", ({ payload }) => { if (project.folders.includes(payload)) update(); }),
      listen<{ folder: string }>("todo-changed", ({ payload }) => { if (project.folders.includes(payload.folder)) update(); }),
    ] : [];
    void Promise.all(stops).catch(() => {});
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("document-files-changed", update);
      clearInterval(interval);
      clearTimeout(timer);
      for (const stop of stops) void stop.then((fn) => fn()).catch(() => {});
    };
  }, [key, refresh]);
  return {
    ...(snapshot?.key === key ? snapshot.data : empty),
    loading: !!project && (status.key !== key || (status.loading && snapshot?.key !== key)),
    error: status.key === key ? status.error : "",
    refresh,
  };
}
