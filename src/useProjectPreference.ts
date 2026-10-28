import { useState, type SetStateAction } from "react";

// Read by scope during render so a project switch cannot write the previous
// project's preferences into the newly selected project.
export function useProjectPreference<T>(scope: string, name: string, fallback: T) {
  const key = `notesdive:project-location:${scope}:${name}`;
  const read = (): T => {
    try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
    catch { return fallback; }
  };
  const [snapshot, setSnapshot] = useState(() => ({ key, value: read() }));
  const value = snapshot.key === key ? snapshot.value : read();
  const setValue = (update: SetStateAction<T>) => {
    const next = typeof update === "function" ? (update as (value: T) => T)(value) : update;
    setSnapshot({ key, value: next });
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { /* Navigation remains usable when storage is unavailable. */ }
  };
  return [value, setValue] as const;
}
