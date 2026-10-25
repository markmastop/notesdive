import { expect, it } from "vitest";
import { renderMarp } from "./marp";
import { insertMarpSlide, removeMarpSlide, moveMarpSlide } from "./marpSlideEdits";

it.each(["\n", "\r\n"])("inserts before and after every slide while preserving original source (%j)", (newline) => {
  const header = ["---", "marp: true", "theme: uncover", "---", ""].join(newline);
  const bodies = ["# First\n<!-- Speaker note -->\n\n", "# Middle\n```md\n---\n```\n\n", "# Last"] .map((body) => body.replaceAll("\n", newline));
  const text = header + bodies.join(`***${newline}`);
  const sources = renderMarp(text).sources;
  for (const index of [0, 1, 2]) for (const side of ["before", "after"] as const) {
    const change = insertMarpSlide(text, sources, index, side);
    const deck = renderMarp(change.text);
    expect(deck.slides).toHaveLength(4);
    expect(deck.slides[change.index].html).toContain("New slide");
    expect(change.text.startsWith(header)).toBe(true);
    const original = deck.sources.filter((_, position) => position !== change.index).map(({ from, to }) => change.text.slice(from, to).trim());
    expect(original).toEqual(bodies.map((body) => body.trim()));
  }
});

it.each([0, 1, 2])("removes slide %i and an adjacent separator without touching the remaining content", (index) => {
  const header = "---\nmarp: true\ntheme: uncover\n---\n";
  const bodies = ["# First\n<!-- First note -->\n\n", "# Middle\n<!-- Delete with slide -->\n\n", "# Last\n"];
  const text = header + bodies.join("---\n");
  const change = removeMarpSlide(text, renderMarp(text).sources, index);
  const result = renderMarp(change.text);
  expect(result.slides).toHaveLength(2);
  expect(change.text).toBe(header + bodies.filter((_, position) => position !== index).join("---\n"));
  expect(change.index).toBe(Math.min(index, 1));
});

it("clears a final slide while preserving presentation settings and allows inserting again", () => {
  const header = "---\nmarp: true\ntheme: uncover\n---\n";
  const text = header + "# Only slide\n<!-- Remove this note too -->";
  const cleared = removeMarpSlide(text, renderMarp(text).sources, 0);
  expect(cleared).toEqual({ text: header, index: 0 });
  expect(renderMarp(cleared.text).slides).toHaveLength(1);
  expect(renderMarp(insertMarpSlide(cleared.text, renderMarp(cleared.text).sources, 0, "after").text).slides).toHaveLength(2);
});


it.each(["\n", "\r\n"])("moves slides with their notes, scoped directives and code, including a final paragraph (%j)", (newline) => {
  const header = "---\nmarp: true\ntheme: uncover\n---\n".replaceAll("\n", newline);
  const bodies = ["# First\n<!-- First notes -->\n\n", "<!-- _class: lead -->\n# Middle\n```md\n---\n```\n\n", "A final paragraph\n<!-- Final notes -->"].map((body) => body.replaceAll("\n", newline));
  const text = header + bodies.join(`---${newline}`);
  for (const [index, direction, order] of [[0, "later", [1, 0, 2]], [1, "earlier", [1, 0, 2]], [1, "later", [0, 2, 1]], [2, "earlier", [0, 2, 1]]] as const) {
    const moved = moveMarpSlide(text, renderMarp(text).sources, index, direction);
    const rendered = renderMarp(moved.text);
    expect(rendered.slides).toHaveLength(3);
    expect(moved.text.startsWith(header)).toBe(true);
    expect(rendered.sources.map(({ from, to }) => moved.text.slice(from, to).trim())).toEqual(order.map((i) => bodies[i].trim()));
    expect(rendered.slides[order.indexOf(2)].html).toContain("<p>A final paragraph</p>");
    expect(rendered.slides[order.indexOf(0)].notes).toEqual(["First notes"]);
    expect(rendered.slides[order.indexOf(2)].notes).toEqual(["Final notes"]);
    expect(moved.index).toBe(order.indexOf(index));
  }
});

it("leaves slides unchanged at either boundary", () => {
  const text = "---\nmarp: true\n---\n# Only";
  const sources = renderMarp(text).sources;
  expect(moveMarpSlide(text, sources, 0, "earlier")).toEqual({ text, index: 0 });
  expect(moveMarpSlide(text, sources, 0, "later")).toEqual({ text, index: 0 });
});
