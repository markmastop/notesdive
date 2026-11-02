import { describe, expect, it } from "vitest";
import { researchMarkdown, researchPrompt, researchSource } from "./research";

describe("research provenance", () => {
  it("preserves supplied URLs and excerpts without treating links as retrieved evidence", () => {
    const source = researchSource("Evidence [original]", "https://example.com/paper?q=one&v=2", "Exact supplied excerpt");
    const prompt = researchPrompt("Explain", [source]);
    expect(prompt).toContain(source.url);
    expect(prompt).toContain("Exact supplied excerpt");
    expect(prompt).toContain("not retrieved or verified");
    expect(prompt).not.toContain("note context");
    expect(researchPrompt("Explain", [source], "Private note")).toContain("Private note");
    const text = researchMarkdown("Draft answer", "test/model:free", [source], new Date("2026-11-02T10:00:00Z"));
    expect(text).toContain("[Evidence \\[original\\]](<https://example.com/paper?q=one&v=2>)");
    expect(text).toContain("Added 2026-11-02");
    expect(text).toContain("not been independently verified");
  });
  it("rejects executable and local source URLs", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,test", "relative/path"]) {
      expect(() => researchSource("Source", url, "")).toThrow();
    }
    expect(researchSource("", "https://example.com", "").title).toBe("example.com");
  });
});
