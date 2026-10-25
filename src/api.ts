import { invoke, isTauri } from "@tauri-apps/api/core";
export interface Folder {
  path: string;
  name: string;
}
export interface Note {
  path: string;
  content: string;
  revision: string;
}
export interface Entry {
  remarkableId?: string;
  remarkableFolderIds?: string[];
  path: string;
  name: string;
  modified: number;
  snippet: string | null;
}
export interface Listing {
  entries: Entry[];
  directories?: string[];
  warnings: string[];
}
export interface Asset {
  path: string;
  mime: string;
  data: string;
}
export interface NotesApi {
  restore(): Promise<Folder | null>;
  choose(): Promise<Folder | null>;
  workspaces(): Promise<Folder[]>;
  switchWorkspace(path: string): Promise<Folder>;
  forgetWorkspace(path: string): Promise<Folder[]>;
  list(folder: string, query: string): Promise<Listing>;
  read(folder: string, path: string): Promise<Note>;
  readAsset(folder: string, path: string): Promise<Asset>;
  save(folder: string, note: Note): Promise<Note>;
  create(folder: string, path: string, content: string): Promise<Note>;
}
export const desktop = isTauri();
export const api: NotesApi = {
  restore: () =>
    desktop ? invoke("restore_workspace") : Promise.resolve(null),
  choose: () => invoke("choose_workspace"),
  workspaces: () => desktop ? invoke("list_workspaces") : Promise.resolve([]),
  switchWorkspace: (path) => invoke("switch_workspace", { path }),
  forgetWorkspace: (path) => invoke("forget_workspace", { path }),
  list: (folder, query) => invoke("list_notes", { folder, query }),
  read: (folder, path) => invoke("read_note", { folder, path }),
  readAsset: (folder, path) => invoke("read_asset", { folder, path }),
  save: (folder, note) => invoke("save_note", { folder, ...note }),
  create: (folder, path, content) =>
    invoke("create_note", { folder, path, content }),
};

// Read registered roots without switching the document editor's active folder.
export const knownFolderApi = {
  list: (folder: string, query: string): Promise<Listing> => invoke("list_known_notes", { folder, query }),
  read: (folder: string, path: string): Promise<Note> => invoke("read_known_note", { folder, path }),
};
