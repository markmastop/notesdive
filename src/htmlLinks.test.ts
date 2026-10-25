import { expect, it } from "vitest";
import { htmlLink } from "./htmlLinks";

it("resolves HTML links relative to their document, including encoded names and anchors", () => {
  expect(htmlLink("Demo/index.html", "Year%202.html#opzet")).toEqual({ path: "Demo/Year 2.html", fragment: "opzet" });
  expect(htmlLink("Demo/index.html", "../notes.md")).toEqual({ path: "notes.md", fragment: "" });
  expect(htmlLink("Demo/index.html", "#year%202")).toEqual({ path: "Demo/index.html", fragment: "year 2" });
  expect(htmlLink("Demo/index.html", "/report.pdf?download=1")).toEqual({ path: "report.pdf", fragment: "" });
  expect(htmlLink("Demo/index.html", "https://example.com/page")).toEqual({ web: "https://example.com/page" });
  expect(htmlLink("Demo/index.html", "//example.com/page")).toEqual({ web: "https://example.com/page" });
});

it("rejects links outside the local root, active schemes and invalid paths", () => {
  for (const href of ["../../outside.html", "%2e%2e/%2e%2e/outside.html", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,test", "x%00.html", "..\\outside.html", "script.js", "%ZZ.html"])
    expect(htmlLink("Demo/index.html", href)).toBeNull();
});
