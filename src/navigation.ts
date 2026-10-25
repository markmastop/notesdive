import type { Folder } from "./api";
import type { Project, Projects } from "./projects";

export type Page = "home" | "projects" | "notes" | "todos" | "remarkable" | "settings";
export type ViewContext = "all" | "project";
export const projectPages = new Set<Page>(["projects", "notes", "todos"]);
export function contextFor(page: Page, requested: ViewContext, project?: Project): ViewContext {
  return requested === "project" && project && projectPages.has(page) ? "project" : "all";
}
export function allFolders(config: Projects, workspaces: Folder[], current: Folder | null) {
  return [...new Set([...workspaces.map((folder) => folder.path), ...(current ? [current.path] : []),
    ...config.projects.filter((project) => !project.archived).flatMap((project) => project.folders)])].sort();
}
export function allWorkProject(folders: string[]): Project {
  return { id: "all-work", name: "All work", color: "sage", description: "", pinned: false, archived: false,
    folders, defaultFolder: null };
}
export function pageTitle(page: Page, context: ViewContext) {
  if (context === "project") return { home: "Home", projects: "Project overview", notes: "Project files", todos: "Project tasks", remarkable: "reMarkable", settings: "Settings" }[page];
  return { home: "Home", projects: "Projects", notes: "All files", todos: "All tasks", remarkable: "All reMarkable files", settings: "Settings" }[page];
}
