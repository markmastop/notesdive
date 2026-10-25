/** Use the local calendar date, matching the export timestamp in the footer. */
export function pdfFilename(documentName: string, date: Date): string {
  const name = documentName
    .trim()
    .replace(/\.(md|markdown|docx|html?|pdf|pptx|txt|png|jpe?g|svg)$/i, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "-") || "NotesDive";
  const today = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `${name}_${today}.pdf`;
}
