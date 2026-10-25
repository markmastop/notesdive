import type { Folder, Note, NotesApi } from "./api";
export type Snapshot = {
  folder: Folder | null;
  note: Note | null;
  text: string;
  savedText: string;
  busy: boolean;
  saving: boolean;
  error: string;
  conflict: boolean;
};
const normalize = (text: string) =>
  text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

// A single document owner serializes saves and navigation. A completed save only
// acknowledges its own snapshot; typing during that save remains unsaved.
export class DocumentSession {
  private state: Snapshot = {
    folder: null,
    note: null,
    text: "",
    savedText: "",
    busy: false,
    saving: false,
    error: "",
    conflict: false,
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<boolean> | null = null;
  private eol = "\n";
  private bom = "";
  constructor(
    private api: NotesApi,
    private delay = 650,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private patch(part: Partial<Snapshot>) {
    this.state = { ...this.state, ...part };
    this.listeners.forEach((fn) => fn());
  }
  get dirty() {
    return this.state.text !== this.state.savedText;
  }
  private load(note: Note | null) {
    this.eol = note?.content.includes("\r\n") ? "\r\n" : "\n";
    this.bom = note?.content.startsWith("\uFEFF") ? "\uFEFF" : "";
    const text = normalize(note?.content ?? "");
    this.patch({ note, text, savedText: text, error: "", conflict: false });
  }
  edit(text: string) {
    if (this.state.busy) return;
    this.patch({ text });
    clearTimeout(this.timer);
    if (!this.state.conflict && !this.state.error)
      this.timer = setTimeout(() => {
        void this.save();
      }, this.delay);
  }
  report(error: unknown) {
    this.patch({ error: String(error) });
  }
  clearError() {
    this.patch({ error: "" });
  }
  private serialized() {
    return this.bom + this.state.text.replace(/\n/g, this.eol);
  }
  async save(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.pending) {
      const ok = await this.pending;
      return ok ? this.save() : false;
    }
    const { folder, note, text, conflict } = this.state;
    if (conflict) return false;
    if (!this.dirty || !folder || !note) return true;
    this.patch({ saving: true, error: "" });
    this.pending = (async () => {
      try {
        const saved = await this.api.save(folder.path, {
          ...note,
          content: this.serialized(),
        });
        this.patch({ note: saved, savedText: text, saving: false });
        return true;
      } catch (e) {
        const error = String(e);
        this.patch({
          saving: false,
          error,
          conflict: error.includes("CONFLICT:"),
        });
        return false;
      }
    })();
    const ok = await this.pending;
    this.pending = null;
    if (ok && this.dirty)
      this.timer = setTimeout(() => {
        void this.save();
      }, this.delay);
    return ok;
  }
  // Lock editing while changing documents, choosing folders, creating or closing.
  private async transition(
    action: () => Promise<void>,
    flush = true,
  ): Promise<boolean> {
    if (this.state.busy) return false;
    this.patch({ busy: true });
    clearTimeout(this.timer);
    try {
      if (flush && !(await this.save())) return false;
      await action();
      return true;
    } catch (e) {
      this.report(e);
      return false;
    } finally {
      this.patch({ busy: false });
    }
  }
  restore() {
    return this.transition(async () => {
      this.patch({ folder: await this.api.restore() });
    });
  }
  async choose() {
    let selected = false;
    const changed = await this.transition(async () => {
      const folder = await this.api.choose();
      if (folder) {
        selected = true;
        this.patch({ folder });
        this.load(null);
      }
    });
    return changed && selected;
  }
  switchWorkspace(path: string) {
    return this.transition(async () => {
      const folder = await this.api.switchWorkspace(path);
      this.patch({ folder });
      this.load(null);
    });
  }
  forgetWorkspace(path: string) {
    return this.transition(async () => {
      await this.api.forgetWorkspace(path);
      if (this.state.folder?.path === path) {
        this.patch({ folder: null });
        this.load(null);
      }
    });
  }
  open(path: string) {
    return this.transition(async () => {
      if (this.state.folder)
        this.load(await this.api.read(this.state.folder.path, path));
    });
  }
  openExternal(open: () => Promise<{ folder: Folder; note: Note }>) {
    return this.transition(async () => {
      const { folder, note } = await open();
      this.patch({ folder });
      this.load(note);
    });
  }
  create(path: string, copy = false) {
    return this.transition(async () => {
      const { folder } = this.state;
      if (!folder) return;
      if (this.pending) await this.pending;
      const content = copy
        ? this.serialized()
        : `# ${path
            .split("/")
            .pop()!
            .replace(/\.(md|markdown)$/i, "")}\n\n`;
      this.load(await this.api.create(folder.path, path, content));
    }, !copy);
  }
  reload() {
    return this.transition(async () => {
      if (this.pending) await this.pending;
      const { folder, note } = this.state;
      if (folder && note)
        this.load(await this.api.read(folder.path, note.path));
    }, false);
  }
  close(action: () => Promise<void>) {
    return this.transition(action);
  }
  closeDocument() {
    return this.transition(async () => this.load(null));
  }
  async syncExternal() {
    if (this.state.busy) return;
    if (this.pending) await this.pending;
    const { folder, note } = this.state;
    if (!folder || !note || this.state.busy) return;
    try {
      const disk = await this.api.read(folder.path, note.path);
      // Ignore responses for a document that has since changed or started saving.
      if (this.state.busy || this.state.note !== note || this.pending) return;
      if (disk.revision === note.revision) return;
      if (normalize(disk.content) === this.state.text) {
        this.load(disk);
        return;
      }
      if (this.dirty) {
        clearTimeout(this.timer);
        this.patch({
          conflict: true,
          error:
            "This note changed outside NotesDive. Your draft is safe here. Save a copy or reload the disk version.",
        });
      } else this.load(disk);
    } catch (e) {
      if (this.state.note === note && !this.state.busy) {
        clearTimeout(this.timer);
        this.patch({
          conflict: true,
          error: `Cannot read this note. It may have been moved or deleted. Save your draft as a copy. ${String(e)}`,
        });
      }
    }
  }
}
