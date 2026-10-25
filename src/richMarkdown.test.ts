import { describe, expect, it } from "vitest";
import { splitMetadata, richUnsupportedReason } from "./richMarkdown";
describe("visual Markdown boundaries", () => {
  it("keeps YAML and TOML headers separate without rewriting their contents", () => {
    for (const prefix of [
      '---\ntitle: "A note"\ntags: [one, two]\n---\n',
      '+++\ntitle = "A note"\n+++\n',
    ]) {
      expect(splitMetadata(prefix + "\n# Hello\n")).toEqual({
        prefix,
        body: "\n# Hello\n",
      });
    }
  });
  it("leaves ordinary text and incomplete frontmatter intact", () => {
    expect(splitMetadata("---\nA paragraph\n---\nMore text")).toEqual({
      prefix: "",
      body: "---\nA paragraph\n---\nMore text",
    });
    expect(splitMetadata("# Title\n---\nText")).toEqual({
      prefix: "",
      body: "# Title\n---\nText",
    });
    expect(splitMetadata("---\ntitle: Note")).toEqual({
      prefix: "",
      body: "---\ntitle: Note",
    });
  });
  it("keeps unsupported footnotes out of the visual serializer", () => {
    expect(richUnsupportedReason("Text[^1]\n\n[^1]: Footnote")).toBeTruthy();
    expect(richUnsupportedReason("# Title\n\n- [ ] Task")).toBeNull();
  });
});
