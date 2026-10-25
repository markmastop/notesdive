import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";
describe("untrusted Markdown preview", () => {
  it("escapes HTML and keeps remote assets inert", () => {
    const html = renderMarkdown(
      "<script>alert(1)</script>\n\n![Private](https://tracker.example/image)\n\n[Link](https://example.com)",
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain('<a class="preview-link" data-web-link href="https://example.com/">');
    expect(html).toContain("[Image: Private]");
  });
  it("leaves non-web links inert", () => {
    const html = renderMarkdown("[Local](notes.md) [Mail](mailto:someone@example.com)");
    expect(html).not.toContain("<a ");
    expect(html).toContain("<span class=\"preview-link\">Local</span>");
  });
  it("renders headings, code, tables and lists", () => {
    const html = renderMarkdown(
      "# Title\n\n- One\n- Two\n\n```js\nconst x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |",
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain("<pre>");
  });
});
