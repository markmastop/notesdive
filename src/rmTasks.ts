import { parse, type RmDocument, type RmItem, type RmParagraph } from "remarkable-rm";

export interface RmTask { text: string; checked: boolean; line: number }
export function extractRmDocumentTasks(document: RmDocument): RmTask[] {
  const tasks: RmTask[] = [];
  let line = 0;
  const paragraphs = (rows: RmParagraph[]) => {
    for (const row of rows) {
      line++;
      const text = row.spans.map((span) => span.text).join("").trim();
      if ((row.style === "checkbox" || row.style === "checkbox-checked") && text) {
        tasks.push({ text, checked: row.style === "checkbox-checked", line });
      }
    }
  };
  const visit = (items: RmItem[]) => {
    for (const item of items) {
      if (item.type === "text") paragraphs(item.paragraphs);
      else if (item.type === "group") visit(item.items);
    }
  };
  for (const page of document.pages) {
    if (page.rootText) paragraphs(page.rootText.paragraphs);
    for (const layer of page.layers) if (layer.visible) visit(layer.items);
  }
  return tasks;
}
export function extractRmTasks(bytes: Uint8Array) {
  if (bytes.length > 20 * 1024 * 1024) throw new Error("This notebook page exceeds the 20 MiB limit.");
  return extractRmDocumentTasks(parse(bytes));
}
