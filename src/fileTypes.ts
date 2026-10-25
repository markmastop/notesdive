export type FileKind = "markdown" | "epub" | "pdf" | "image" | "html" | "docx" | "pptx" | "text";

export function fileKind(path: string): FileKind | null {
  if (/\.(md|markdown)$/i.test(path)) return "markdown";
  if (/\.epub$/i.test(path)) return "epub";
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.(svg|png|jpe?g)$/i.test(path)) return "image";
  if (/\.html?$/i.test(path)) return "html";
  if (/\.docx$/i.test(path)) return "docx";
  if (/\.pptx$/i.test(path)) return "pptx";
  if (/\.txt$/i.test(path)) return "text";
  return null;
}

export const isMarkdown = (path: string) => fileKind(path) === "markdown";
