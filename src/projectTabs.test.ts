import { describe, expect, it } from "vitest";
import { openProjectIds, projectTabScope, readProjectTabs } from "./projectTabs";
import { allWorkProject } from "./navigation";
const project = allWorkProject([]);
describe("open project tabs", () => {
  it("keeps tab order and adds the active project while pruning removed and archived projects", () => {
    const config = { active: "new", projects: [
      { ...project, id: "first" }, { ...project, id: "new" }, { ...project, id: "archived", archived: true },
    ] };
    expect(openProjectIds(["first", "removed", "first", "archived"], config)).toEqual(["first", "new"]);
    expect(openProjectIds(["first"], { ...config, active: null })).toEqual(["first"]);
    expect(openProjectIds([], { ...config, active: "archived" })).toEqual([]);
  });
  it("separates libraries and recovers malformed saved preferences", () => {
    expect(projectTabScope({ active: null, projects: [] })).toBe("null");
    expect(projectTabScope({ library: "/library", active: null, projects: [] })).toBe('"/library"');
    expect(readProjectTabs('{"null":["one",7,"one","two"],"bad":false}')).toEqual({ null: ["one", "two"] });
    for (const value of [null, "broken", "[]", "null"]) expect(readProjectTabs(value)).toEqual({});
  });
});
