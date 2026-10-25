import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./api";
import type { Projects } from "./projects";
export interface Library {
  path: string;
  name: string;
  available: boolean;
}
export interface Libraries {
  active: string | null;
  libraries: Library[];
  legacyProjects: number;
  legacyError?: string | null;
}
export const emptyLibraries: Libraries = {
  active: null,
  libraries: [],
  legacyProjects: 0,
};
export const libraryApi = {
  themes: (library: string, create = false): Promise<{ path: string; exists: boolean; themes: string[] }> => invoke("library_themes", { library, create }),
  list: (): Promise<Libraries> =>
    desktop ? invoke("list_libraries") : Promise.resolve(emptyLibraries),
  choose: (name: string | null): Promise<boolean> =>
    invoke("choose_library", { name }),
  switch: (path: string | null): Promise<void> =>
    invoke("switch_library", { path }),
  forget: (path: string): Promise<void> => invoke("forget_library", { path }),
  importLegacy: (): Promise<Projects> => invoke("import_legacy_projects"),
};
