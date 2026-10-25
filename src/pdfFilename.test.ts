import { describe, expect, it } from "vitest";
import { pdfFilename } from "./pdfFilename";

describe("PDF filenames", () => {
  it("replaces spaces and appends the local date before the PDF extension", () => {
    expect(pdfFilename("Project validatie.md", new Date(2026, 9, 2))).toBe("Project_validatie_20261002.pdf");
  });
  it("pads single-digit months and days and handles all supported file extensions", () => {
    for (const extension of ["markdown", "DOCX", "html", "pdf", "pptx", "txt", "png", "jpg", "jpeg", "svg"]) {
      expect(pdfFilename(`validatie.${extension}`, new Date(2026, 0, 5))).toBe("validatie_20260105.pdf");
    }
  });
  it("uses a safe fallback and removes characters that cannot be in a filename", () => {
    expect(pdfFilename("  .md  ", new Date(2026, 9, 2))).toBe("NotesDive_20261002.pdf");
    expect(pdfFilename("Project: validatie.md", new Date(2026, 9, 2))).toBe("Project-_validatie_20261002.pdf");
  });
  it("uses the local calendar day rather than the UTC date", () => {
    const date = new Date(2026, 9, 2, 0, 1);
    expect(pdfFilename("validatie", date)).toBe("validatie_20261002.pdf");
  });
});
