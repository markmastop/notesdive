import { openEpub } from "./epub";
import { exportPdf } from "./pdfExport";

export async function exportEpubPdf(options: { data: string; name: string; chapter: number | null; signal?: AbortSignal; progress: (loaded: number, total: number) => void }) {
  const book = await openEpub(options.data);
  const chapters = options.chapter === null ? book.chapters.map((_, index) => index) : [options.chapter];
  const source = document.createElement("article");
  let loaded = 0;
  for (const index of chapters) {
    options.signal?.throwIfAborted();
    const section = document.createElement("section");
    section.innerHTML = await book.chapter(index);
    source.append(section);
    options.progress(++loaded, chapters.length);
  }
  options.signal?.throwIfAborted();
  return exportPdf({ title: book.title, documentName: options.name, source, signal: options.signal });
}
