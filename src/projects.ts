import { invoke } from "@tauri-apps/api/core";
import MarkdownIt from "markdown-it";
import { splitMetadata } from "./richMarkdown";
import {
  desktop,
  type Folder,
  type Listing,
  type Note,
  type Entry,
} from "./api";
import { TodoIndex, type Todo } from "./todos";
import type { ProjectIconName } from "./ProjectIcon";

export interface RemarkableFolderLink { id: string; name: string }
export const projectColors = [
  { value: "sage", label: "Sage" },
  { value: "forest", label: "Forest" },
  { value: "teal", label: "Teal" },
  { value: "cyan", label: "Cyan" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "lavender", label: "Lavender" },
  { value: "rose", label: "Rose" },
  { value: "coral", label: "Coral" },
  { value: "orange", label: "Orange" },
  { value: "amber", label: "Amber" },
  { value: "graphite", label: "Graphite" },
] as const;
/** Portable mappings and last successful versions live in the project file. */
export interface RemarkableSyncFolder {
  id: string;
  localFolder: string;
  path: string;
  remoteParentId: string;
  enabled: boolean;
  state?: import("./remarkableFolderSync").SyncJournal | null;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: typeof projectColors[number]["value"];
  icon?: ProjectIconName;
  pinned: boolean;
  archived: boolean;
  folders: string[];
  defaultFolder: string | null;
  remarkableFolders?: RemarkableFolderLink[];
  remarkableSync?: RemarkableSyncFolder[];
}
export interface Projects {
  library?: string | null;
  revision?: string;
  reconnections?: { projectId: string; from: string; to: string }[];
  active: string | null;
  projects: Project[];
}
export const projectApi = {
  load: (): Promise<Projects> =>
    desktop
      ? invoke("load_projects")
      : Promise.resolve({ active: null, projects: [] }),
  save: (config: Projects): Promise<Projects> =>
    invoke("save_projects", { config }),
  choose: (): Promise<Folder | null> => invoke("choose_project_folder"),
  list: (
    projectId: string,
    folder: string,
    query: string,
    library: string | null = null,
  ): Promise<Listing> =>
    invoke("list_project_notes", { projectId, folder, query, library }),
  read: (
    projectId: string,
    folder: string,
    path: string,
    library: string | null = null,
  ): Promise<Note> =>
    invoke("read_project_note", { projectId, folder, path, library }),
};
export type ProjectEntry = Entry & { folder: string };
export type ProjectTodo = Todo & { folder: string };
export type ProjectLink = {
  folder: string;
  path: string;
  label: string;
  url: string;
};
const linkParser = new MarkdownIt({ html: false, linkify: true });
export function parseProjectLinks(note: Note): Omit<ProjectLink, "folder">[] {
  const { prefix } = splitMetadata(note.content);
  const links: Omit<ProjectLink, "folder">[] = [];
  const seen = new Set<string>();
  for (const block of linkParser.parse(note.content.slice(prefix.length), {})) {
    const children = block.children ?? [];
    children.forEach((token, i) => {
      const url = token.type === "link_open" ? token.attrGet("href") : null;
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return;
      let label = "";
      for (
        let j = i + 1;
        j < children.length && children[j].type !== "link_close";
        j++
      ) {
        if (["text", "code_inline", "image"].includes(children[j].type))
          label += children[j].content;
      }
      seen.add(url);
      links.push({ path: note.path, label: label || url, url });
    });
  }
  return links;
}
export const folderName = (path: string) =>
  path.startsWith("remarkable:") ? `reMarkable · ${path.slice("remarkable:".length).split(":").slice(1).join(":").replace(/[\\/]/g, "⁄")}` : path.split(/[\\/]/).filter(Boolean).pop() || path;
export const displayFolder = (path: string) =>
  path.startsWith("notesdive-external:")
    ? `${folderName(path)} — reconnect on this computer`
    : path;
export const resourceKey = (folder: string, path: string) =>
  JSON.stringify([folder, path]);
export function removeFolder(project: Project, folder: string): Project {
  const folders = project.folders.filter((p) => p !== folder);
  return {
    ...project,
    folders,
    remarkableSync: project.remarkableSync?.filter((link) => link.localFolder !== folder),
    defaultFolder:
      project.defaultFolder === folder
        ? (folders[0] ?? null)
        : project.defaultFolder,
  };
}

/** Root identity is part of every result; identical filenames in separate roots stay distinct. */
export class ProjectIndex {
  private indexes = new Map<string, TodoIndex>();
  private sourceListings = new Map<string, Listing>();
  constructor(
    private api: Pick<typeof projectApi, "list" | "read">,
    private projectId: string,
  ) {}
  async scan(
    folders: string[],
    query: string,
    force: boolean,
    signal: AbortSignal,
  ) {
    const entries: ProjectEntry[] = [],
      tasks: ProjectTodo[] = [],
      warnings: string[] = [];
    const unavailable: string[] = [];
    const links: ProjectLink[] = [];
    const linkFiles: ProjectEntry[] = [];
    const seenFiles = new Set<string>(),
      seenTasks = new Set<string>();
    for (const folder of folders) {
      signal.throwIfAborted();
      try {
        const listing = await this.api.list(this.projectId, folder, query);
        const index =
          this.indexes.get(folder) ??
          new TodoIndex({
            list: async (root, search) => {
              const result = await this.api.list(this.projectId, root, search);
              this.sourceListings.set(root, result);
              return result;
            },
            read: (root, path) => this.api.read(this.projectId, root, path),
          });
        this.indexes.set(folder, index);
        const todos = await index.scan(folder, force, [], signal);
        signal.throwIfAborted();
        for (const entry of this.sourceListings.get(folder)?.entries ?? []) {
          if (!/(^|\/)links\.(md|markdown)$/i.test(entry.path)) continue;
          const absolute = `${folder.replace(/\\/g, "/").replace(/\/$/, "")}/${entry.path}`;
          if (
            linkFiles.some(
              (file) =>
                `${file.folder.replace(/\\/g, "/").replace(/\/$/, "")}/${file.path}` ===
                absolute,
            )
          )
            continue;
          linkFiles.push({ ...entry, folder });
          try {
            const note = await this.api.read(
              this.projectId,
              folder,
              entry.path,
            );
            signal.throwIfAborted();
            links.push(
              ...parseProjectLinks(note).map((link) => ({ ...link, folder })),
            );
          } catch (error) {
            signal.throwIfAborted();
            warnings.push(`${folder}/${entry.path}: ${String(error)}`);
          }
        }
        for (const entry of listing.entries) {
          const absolute = `${folder.replace(/\\/g, "/").replace(/\/$/, "")}/${entry.path}`;
          if (!seenFiles.has(absolute)) {
            entries.push({ ...entry, folder });
            seenFiles.add(absolute);
          }
        }
        for (const task of todos.tasks) {
          const absolute = `${folder.replace(/\\/g, "/").replace(/\/$/, "")}/${task.path}:${task.offset}`;
          if (!seenTasks.has(absolute)) {
            tasks.push({ ...task, folder });
            seenTasks.add(absolute);
          }
        }
        warnings.push(
          ...new Set(
            [...listing.warnings, ...todos.warnings].map(
              (warning) => `${folder}: ${warning}`,
            ),
          ),
        );
      } catch (error) {
        signal.throwIfAborted();
        unavailable.push(folder);
        warnings.push(`${folder}: ${String(error)}`);
      }
    }
    entries.sort(
      (a, b) => b.modified - a.modified || a.path.localeCompare(b.path),
    );
    const seenInventory = new Set<string>();
    const inventory = [...this.sourceListings].filter(([folder]) => folders.includes(folder) && !unavailable.includes(folder))
      .flatMap(([folder, listing]) => listing.entries.map((entry) => ({ ...entry, folder })))
      .filter((entry) => {
        const absolute = `${entry.folder.replace(/\\/g, "/").replace(/\/$/, "")}/${entry.path}`;
        if (seenInventory.has(absolute)) return false;
        seenInventory.add(absolute);
        return true;
      });
    const directories = folders.filter((folder) => !unavailable.includes(folder))
      .flatMap((folder) => (this.sourceListings.get(folder)?.directories ?? []).map((path) => ({ folder, path })));
    return { entries, inventory, directories, tasks, links, linkFiles, warnings, unavailable };
  }
}
