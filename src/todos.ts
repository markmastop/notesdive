import MarkdownIt from "markdown-it";
import { splitMetadata } from "./richMarkdown";
import type { NotesApi, Note } from "./api";
import { isMarkdown } from "./fileTypes";

export interface Todo {
  readOnly?: boolean;
  remarkableId?: string;
  page?: number;
  path: string;
  line: number;
  offset: number;
  text: string;
  checked: boolean;
  revision: string;
  due?: string;
  start?: string;
  priority?: "urgent" | "high" | "normal" | "medium" | "low";
  assignee?: string;
  stage?: "backlog" | "todo" | "doing" | "review" | "blocked" | "done";
  tags?: string[];
}
export interface TodoListing {
  tasks: Todo[];
  warnings: string[];
  files: number;
}
const parser = new MarkdownIt({ html: true });
const normalizedPath = (path: string) =>
  path.replace(/\\/g, "/").replace(/\/+$/, "");

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function compareTodoUrgency(a: Todo, b: Todo): number {
  const byDue = (a.due ?? "9999-12-31").localeCompare(b.due ?? "9999-12-31");
  if (byDue) return byDue;
  const rank = { urgent: 0, high: 1, normal: 2, medium: 2, low: 3 };
  return (rank[a.priority ?? "normal"] - rank[b.priority ?? "normal"]) || a.path.localeCompare(b.path) || a.line - b.line;
}

function taskMetadata(label: string) {
  let due: string | undefined, start: string | undefined, priority: Todo["priority"], assignee: string | undefined, stage: Todo["stage"];
  const tags: string[] = [];
  // Metadata is kept in the Markdown source. Only recognized, valid fields are removed from the display label.
  const strip = (part: string) => part.replace(/(^|\s)\[(assignee|start|due|priority|stage)::\s*([^\]\r\n]+?)\s*\](?=\s|$)/giu, (full, space: string, key: string, raw: string) => {
    const value = raw.trim();
    switch (key.toLowerCase()) {
      case "due":
      case "start":
        if (!validDate(value)) return full;
        if (key.toLowerCase() === "due") due = value;
        else start = value;
        break;
      case "priority":
        if (!/^(urgent|high|normal|medium|low)$/i.test(value)) return full;
        priority = value.toLowerCase() as Todo["priority"];
        break;
      case "assignee":
        if (!/^@[\p{L}\p{N}_-]+$/u.test(value)) return full;
        assignee = value;
        break;
      case "stage":
        if (!/^(backlog|todo|doing|review|blocked|done)$/i.test(value)) return full;
        stage = value.toLowerCase() as Todo["stage"];
        break;
    }
    return space;
  }).replace(/(^|\s)(due|start):(\d{4}-\d{2}-\d{2})\b|(^|\s)priority:(high|medium|low)\b|(^|\s)#([\p{L}\p{N}_-]+)/giu, (full, dateSpace: string | undefined, dateKind: string | undefined, dateValue: string | undefined, prioritySpace: string | undefined, priorityValue: string | undefined, tagSpace: string | undefined, tagValue: string | undefined) => {
    if (dateKind && dateValue) {
      if (!validDate(dateValue)) return full;
      if (dateKind.toLowerCase() === "due") due = dateValue;
      else start = dateValue;
      return dateSpace ?? "";
    }
    if (priorityValue) {
      priority = priorityValue.toLowerCase() as Todo["priority"];
      return prioritySpace ?? "";
    }
    if (tagValue) {
      tags.push(tagValue);
      return tagSpace ?? "";
    }
    return full;
  });
  const text = (parser.parseInline(label, {})[0]?.children ?? []).map((token) =>
    token.type === "text" ? strip(token.content) :
    ["code_inline", "image"].includes(token.type) ? token.content :
    ["softbreak", "hardbreak"].includes(token.type) ? " " : "",
  ).join("");
  return { text: text.replace(/ {2,}/g, " ").trim(), due, start, priority, assignee, stage, tags };
}

/** Token maps distinguish real list tasks from examples in code/HTML/metadata. */
export function parseTodos(note: Note): Todo[] {
  const normalized = note.content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const { prefix } = splitMetadata(normalized);
  const source =
    prefix.replace(/[^\n]/g, " ") + normalized.slice(prefix.length);
  const lines = note.content.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g) ?? [];
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length;
  }
  const tokens = parser.parse(source, {});
  const tasks: Todo[] = [];
  tokens.forEach((token, i) => {
    if (
      token.type !== "inline" ||
      tokens[i - 1]?.type !== "paragraph_open" ||
      tokens[i - 2]?.type !== "list_item_open" ||
      !token.map
    )
      return;
    const marker = token.content.match(/^\[([ xX])\](?:\s+|$)/);
    if (!marker) return;
    const line = token.map[0];
    const match = lines[line]?.match(/\[([ xX])\](?=\s|$)/);
    if (!match || match.index === undefined) return;
    const label = token.content.slice(marker[0].length);
    const metadata = taskMetadata(label);
    const text = metadata.text;
    tasks.push({
      path: note.path,
      line: line + 1,
      offset: offsets[line] + match.index + 1,
      text: text || "Untitled task",
      checked: marker[1].toLowerCase() === "x",
      revision: note.revision,
      due: metadata.due,
      start: metadata.start,
      priority: metadata.priority,
      assignee: metadata.assignee,
      stage: metadata.stage,
      tags: metadata.tags,
    });
  });
  return tasks;
}

/** No document bodies or persistent cache: only task summaries and file stamps. */
export class TodoIndex {
  private cache = new Map<string, { modified: number; tasks: Todo[] }>();
  constructor(private api: Pick<NotesApi, "list" | "read">) {}
  async scan(
    folder: string,
    force = false,
    changed: string[] = [],
    signal?: AbortSignal,
  ): Promise<TodoListing> {
    const listing = await this.api.list(folder, "");
    const next = new Map<string, { modified: number; tasks: Todo[] }>();
    const warnings = [...listing.warnings];
    for (const entry of listing.entries.filter((item) => isMarkdown(item.path))) {
      signal?.throwIfAborted();
      const cached = this.cache.get(entry.path);
      const absolute = `${normalizedPath(folder)}/${entry.path}`;
      const affected = changed.some(
        (path) =>
          absolute === normalizedPath(path) ||
          absolute.startsWith(normalizedPath(path) + "/"),
      );
      if (!force && !affected && cached?.modified === entry.modified) {
        next.set(entry.path, cached);
        continue;
      }
      try {
        const note = await this.api.read(folder, entry.path);
        next.set(entry.path, {
          modified: entry.modified,
          tasks: parseTodos(note),
        });
      } catch (error) {
        warnings.push(`${entry.path}: ${String(error)}`);
      }
    }
    this.cache = next;
    return {
      tasks: [...next.values()].flatMap((v) => v.tasks),
      warnings,
      files: listing.entries.filter((item) => isMarkdown(item.path)).length,
    };
  }
}

export async function toggleTodo(
  api: Pick<NotesApi, "read" | "save">,
  folder: string,
  task: Todo,
): Promise<void> {
  if (task.readOnly) throw new Error("reMarkable tasks are read-only. Edit them on your tablet.");
  const note = await api.read(folder, task.path);
  if (note.revision !== task.revision)
    throw new Error(
      "This note changed. The task list has been refreshed; please try again.",
    );
  const current = parseTodos(note).find(
    (t) => t.offset === task.offset && t.checked === task.checked,
  );
  if (!current)
    throw new Error("This task moved. Refresh the task list and try again.");
  const content =
    note.content.slice(0, task.offset) +
    (task.checked ? " " : "x") +
    note.content.slice(task.offset + 1);
  await api.save(folder, { ...note, content });
}
