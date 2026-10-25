import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

/** Parse PDFs before upload; malformed, encrypted and oversized documents stay local. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes });
  task.onPassword = () => { void task.destroy(); };
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > 300) throw new Error("PDF sync supports 1–300 pages per document.");
    return pdf.numPages;
  } finally { await task.destroy(); }
}
