import { expect, it } from "vitest";
import { localImagePath } from "./localImages";
import { renderMarkdown } from "./markdown";

it("resolves images beside notes and within the selected workspace", () => {
  expect(localImagePath("Chretien.md", "Chretien.svg")).toBe("Chretien.svg");
  expect(localImagePath("Notes/page.md", "../images/sketch%20one.png")).toBe("images/sketch one.png");
  expect(localImagePath("Notes/page.md", "../../outside.svg")).toBeNull();
});

it("keeps remote images inert", () => {
  expect(localImagePath("note.md", "https://example.com/picture.png")).toBeNull();
  expect(localImagePath("note.md", "/tmp/private.svg")).toBeNull();
  expect(localImagePath("note.md", "data:image/png;base64,AAAA")).toBeNull();
  const html = renderMarkdown("![Handwritten note](Chretien.svg)");
  expect(html).toContain('data-local-image="Chretien.svg"');
  expect(html).not.toContain("<img");
});
