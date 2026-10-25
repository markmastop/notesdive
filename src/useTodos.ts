import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, desktop } from "./api";
import { TodoIndex, type TodoListing } from "./todos";

const empty: TodoListing = { tasks: [], warnings: [], files: 0 };
export function useTodos(
  folder?: string,
  savedPath?: string,
  revision?: string,
) {
  const [data, setData] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const schedule = useRef<(force?: boolean, paths?: string[]) => void>(
    () => {},
  );
  const refresh = useCallback(
    (force = true, paths: string[] = []) => schedule.current(force, paths),
    [],
  );
  useEffect(() => {
    setData(empty);
    setError("");
    setLoading(false);
    if (!folder) {
      schedule.current = () => {};
      return;
    }
    const index = new TodoIndex(api);
    const controller = new AbortController();
    let alive = true,
      running = false,
      pending = false,
      full = false;
    let timer: ReturnType<typeof setTimeout>;
    const dirty = new Set<string>();
    const run = async () => {
      if (!alive || running) return;
      running = true;
      setLoading(true);
      while (alive && pending) {
        pending = false;
        const force = full,
          paths = [...dirty];
        full = false;
        dirty.clear();
        try {
          const result = await index.scan(
            folder,
            force,
            paths,
            controller.signal,
          );
          if (alive) {
            setData(result);
            setError("");
          }
        } catch (e) {
          if (alive) setError(String(e));
        }
      }
      running = false;
      if (alive) setLoading(false);
    };
    const request = (force = false, paths: string[] = []) => {
      full ||= force;
      paths.forEach((p) => dirty.add(p));
      pending = true;
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 180);
    };
    schedule.current = request;
    request(true);
    const focus = () => request(true);
    window.addEventListener("focus", focus);
    const stop = desktop
      ? listen<{ folder: string; paths: string[] }>("todo-changed", (event) => {
          if (event.payload.folder === folder)
            request(event.payload.paths.length === 0, event.payload.paths);
        })
      : Promise.resolve(() => {});
    void stop.catch((e) => {
      if (alive) setError(`File watcher: ${String(e)}`);
    });
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
      schedule.current = () => {};
      window.removeEventListener("focus", focus);
      void stop.then((fn) => fn()).catch(() => {});
    };
  }, [folder]);
  useEffect(() => {
    if (folder && savedPath) refresh(false, [`${folder}/${savedPath}`]);
  }, [folder, savedPath, revision, refresh]);
  return { ...data, loading, error, refresh };
}
