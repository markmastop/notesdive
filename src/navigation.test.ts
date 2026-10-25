import { describe, expect, it } from "vitest";
import { allFolders, allWorkProject, contextFor, type Page } from "./navigation";
import { selectedProject } from "./projectScope";
const project = { ...allWorkProject(["/shared", "/project"]), id: "project" };
describe("navigation contexts", () => {
  it("keeps global screens global even with a selected project", () => {
    for (const page of ["home", "remarkable", "settings"] as Page[]) {
      expect(contextFor(page, "project", project)).toBe("all");
    }
    for (const page of ["projects", "notes", "todos"] as Page[]) {
      expect(contextFor(page, "all", project)).toBe("all");
      expect(contextFor(page, "project", project)).toBe("project");
      expect(contextFor(page, "project")).toBe("all");
      expect(contextFor(page, "project", selectedProject({active:project.id,projects:[{...project,archived:true}]}))).toBe("all");
    }
  });
  it("collects registered and linked folders independently of the last editor folder", () => {
    const config = {active:project.id,projects:[project,{...project,id:"other",folders:["/shared","/other"]},{...project,id:"archive",archived:true,folders:["/archived"]}]};
    const folders=[{path:"/saved",name:"Saved"},{path:"/shared",name:"Shared"}];
    expect(allFolders(config,folders,null)).toEqual(["/other","/project","/saved","/shared"]);
    expect(allFolders(config,folders,{path:"/project",name:"Project"})).toEqual(allFolders(config,folders,null));
    expect(allFolders({...config,active:null},folders,null)).toEqual(allFolders(config,folders,null));
  });
});
