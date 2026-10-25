import { useEffect, useState } from "react";
import type { Projects } from "./projects";
import { openProjectIds, projectTabScope, projectTabsKey, readProjectTabs } from "./projectTabs";

export function useProjectTabs(config: Projects, ready: boolean) {
  const [saved, setSaved] = useState(() => {
    try { return readProjectTabs(localStorage.getItem(projectTabsKey)); }
    catch { return {}; }
  });
  const scope = projectTabScope(config);
  const ids = ready ? openProjectIds(saved[scope] ?? [], config) : [];
  useEffect(() => {
    if (!ready) return;
    setSaved((previous) => ({ ...previous, [scope]: openProjectIds(previous[scope] ?? [], config) }));
  }, [scope, ready, config.projects, config.active]);
  useEffect(() => {
    try { localStorage.setItem(projectTabsKey, JSON.stringify(saved)); }
    catch { /* Tab preferences must not prevent access to documents. */ }
  }, [saved]);
  return {
    projects: ids.map((id) => config.projects.find((project) => project.id === id)!),
    close: (id: string) => setSaved((previous) => ({ ...previous, [scope]: (previous[scope] ?? []).filter((open) => open !== id) })),
  };
}
