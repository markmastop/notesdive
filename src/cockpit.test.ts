import { describe, expect, it } from "vitest";
import { focusTasks, needsAttention, streamData, weekBounds } from "./cockpit";
import type { HomeData, HomeTask } from "./home";

const task = (text: string, fields: Partial<HomeTask> = {}): HomeTask => ({
  text, path: "Plan.md", folder: "/notes", projectIds: ["directie"],
  line: 1, offset: 0, revision: "1", checked: false, ...fields,
});
const now = new Date(2026, 9, 8, 12);

describe("cockpit priorities and streams", () => {
  it("counts only open tasks and allows overdue blocked tasks in both attention categories", () => {
    const blocked = task("Waiting", { due: "2026-10-07", stage: "blocked" });
    expect(needsAttention(blocked, "overdue", "2026-10-08")).toBe(true);
    expect(needsAttention(blocked, "blocked", "2026-10-08")).toBe(true);
    expect(needsAttention(task("Done", { checked: true, due: "2026-10-08" }), "today", "2026-10-08")).toBe(false);
    expect(needsAttention(task("No deadline"), "overdue", "2026-10-08")).toBe(false);
  });

  it("places urgent undated actions before ordinary future deadlines, after overdue actions", () => {
    const tasks = [task("Later", { due: "2026-10-09" }), task("Urgent", { priority: "urgent" }),
      task("Overdue", { due: "2026-10-07" }), task("Done", { checked: true })];
    expect(focusTasks(tasks, "2026-10-08").map((task) => task.text)).toEqual(["Overdue", "Urgent", "Later"]);
  });

  it("uses Monday to Sunday locally and includes starts as well as deadlines", () => {
    const week = weekBounds(now);
    expect(week.first).toBe("2026-10-05");
    expect(week.last).toBe("2026-10-12");
    const data: HomeData = { warnings: [], tasks: [task("Monday", { start: "2026-10-05" }),
      task("Sunday", { due: "2026-10-11" }), task("Next week", { due: "2026-10-12" }), task("Undated")],
      entries: [
        { folder: "/notes", path: "This.md", name: "This.md", projectIds: ["directie"], modified: week.start, snippet: null },
        { folder: "/notes", path: "Next.md", name: "Next.md", projectIds: ["directie"], modified: week.end, snippet: null },
      ] };
    const stream = streamData(data, { week: true }, now);
    expect(stream.tasks.map((task) => task.text)).toEqual(["Sunday", "Monday"]);
    expect(stream.entries.map((entry) => entry.name)).toEqual(["This.md"]);
  });

  it("combines exact project and case-insensitive task tags without claiming document tags", () => {
    const data: HomeData = { warnings: [], tasks: [
      task("Match", { tags: ["Besluiten"] }), task("Other project", { projectIds: ["onderwijs"], tags: ["besluiten"] }),
      task("Partial tag", { tags: ["besluiten-extra"] }), task("Closed", { checked: true, tags: ["besluiten"] }),
    ], entries: [{ folder: "/notes", path: "Plan.md", name: "Plan.md", projectIds: ["directie"], modified: 1, snippet: null }] };
    const stream = streamData(data, { projectId: "directie", tag: "#besluiten" }, now);
    expect(stream.tasks.map((task) => task.text)).toEqual(["Match"]);
    expect(stream.entries).toEqual([]);
    expect(streamData(data, { projectId: "directie" }, now).entries).toHaveLength(1);
  });
});
