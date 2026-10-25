import type { HomeData, HomeTask } from "./home";
import { compareTodoUrgency, localToday } from "./todos";

export type Attention = "overdue" | "today" | "blocked";
export type Stream = { id: string; name: string; projectId: string; tag: string };
export type StreamFilter = { projectId?: string; tag?: string; week?: boolean };

export function needsAttention(task: HomeTask, kind: Attention, today = localToday()) {
  return !task.checked && (kind === "blocked" ? task.stage === "blocked"
    : kind === "today" ? task.due === today : !!task.due && task.due < today);
}

export function focusTasks(tasks: HomeTask[], today = localToday()) {
  return tasks.filter((task) => !task.checked).sort((a, b) => {
    const rank = (task: HomeTask) =>
      task.due && task.due <= today ? 0 : task.priority === "urgent" ? 1
        : task.priority === "high" ? 2 : task.stage === "doing" ? 3 : 4;
    return rank(a) - rank(b) || compareTodoUrgency(a, b);
  });
}

/** Calendar boundaries are local, including weeks that cross a daylight-saving change. */
export function weekBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: start.getTime(), end: end.getTime(), first: localToday(start), last: localToday(end) };
}

export function streamData(data: HomeData, filter: StreamFilter, now = new Date()) {
  const week = weekBounds(now);
  const projectMatches = (item: { projectIds: string[] }) => !filter.projectId || item.projectIds.includes(filter.projectId);
  const tag = filter.tag?.replace(/^#/, "").toLocaleLowerCase();
  const tasks = focusTasks(data.tasks.filter((task) => projectMatches(task)
    && (!tag || task.tags?.some((value) => value.toLocaleLowerCase() === tag))
    && (!filter.week || [task.due, task.start].some((date) => date && date >= week.first && date < week.last))), localToday(now));
  // Tags currently belong to Markdown tasks, not the document inventory.
  const entries = tag ? [] : data.entries.filter((entry) => projectMatches(entry)
    && (!filter.week || entry.modified >= week.start && entry.modified < week.end))
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  return { tasks, entries };
}

const storageKey = (library: string | null) => `notesdive:streams:${library ?? "local"}`;
export function readStreams(library: string | null): Stream[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(library)) ?? "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((stream): stream is Stream => {
      if (!stream || typeof stream !== "object" || typeof stream.id !== "string" || !stream.id
        || typeof stream.name !== "string" || !stream.name.trim()
        || typeof stream.projectId !== "string" || typeof stream.tag !== "string"
        || seen.has(stream.id)) return false;
      seen.add(stream.id);
      return true;
    }).slice(0, 30);
  } catch { return []; }
}

export function saveStreams(library: string | null, streams: Stream[]) {
  localStorage.setItem(storageKey(library), JSON.stringify(streams));
}
