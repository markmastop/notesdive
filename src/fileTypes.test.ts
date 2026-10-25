import { expect, it } from "vitest";
import { fileKind } from "./fileTypes";

it("recognizes only Markdown and supported view-only files", () => {
  expect(fileKind("Notes/idea.MD")).toBe("markdown");
  expect(fileKind("Book.EPUB")).toBe("epub");
  expect(fileKind("Book.PDF")).toBe("pdf");
  expect(fileKind("diagram.svg")).toBe("image");
  expect(fileKind("photo.PNG")).toBe("image");
  expect(fileKind("photo.jpeg")).toBe("image");
  expect(fileKind("page.html")).toBe("html");
  expect(fileKind("page.HTM")).toBe("html");
  expect(fileKind("notes.docx")).toBe("docx");
  expect(fileKind("slides.PPTX")).toBe("pptx");
  expect(fileKind("notes.TXT")).toBe("text");
  expect(fileKind("archive.zip")).toBeNull();
});
