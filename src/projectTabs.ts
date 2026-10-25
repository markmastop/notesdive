import type { Projects } from "./projects";

export const projectTabsKey = "notesdive-open-projects";
export type ProjectTabs = Record<string, string[]>;
export const projectTabScope = (config: Projects) => JSON.stringify(config.library ?? null);

export function readProjectTabs(value: string | null): ProjectTabs {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, ids]) => Array.isArray(ids))
      .map(([scope, ids]) => [scope, [...new Set((ids as unknown[]).filter((id): id is string => typeof id === "string"))]]));
  } catch { return {}; }
}

export function openProjectIds(ids: string[], config: Projects): string[] {
  const available = new Set(config.projects.filter((project) => !project.archived).map((project) => project.id));
  return [...new Set([...ids, ...(config.active ? [config.active] : [])])].filter((id) => available.has(id));
}
