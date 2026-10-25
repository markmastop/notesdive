import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { openEpub, type EpubBook } from "./epub";
import { isolatedPage } from "./isolatedPage";

export function EpubViewer({ data, onChapterChange }: { data: string; onChapterChange?: (index: number) => void }) {
  const [book, setBook] = useState<EpubBook | null>(null);
  const [chapter, setChapter] = useState(0);
  const [html, setHtml] = useState("");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setBook(null); setChapter(0); setHtml(""); setError("");
    void openEpub(data).then((book) => { if (alive) setBook(book); }).catch((cause) => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [data]);
  useEffect(() => {
    if (!book) return;
    let alive = true;
    setHtml(""); setError(""); onChapterChange?.(chapter);
    void book.chapter(chapter).then((html) => { if (alive) setHtml(html); }).catch((cause) => { if (alive) setError(String(cause)); });
    return () => { alive = false; };
  }, [book, chapter, onChapterChange]);
  return <div className="epub-viewer remarkable-preview-pane" aria-label="EPUB viewer">
    <div className="pdf-toolbar">
      <button aria-label="Previous chapter" disabled={!book || chapter === 0} onClick={() => setChapter((value) => value - 1)}><ChevronLeft size={16} /></button>
      <select aria-label="EPUB chapter" disabled={!book} value={chapter} onChange={(event) => setChapter(Number(event.target.value))}>
        {book ? book.chapters.map((entry, index) => <option key={entry.path} value={index}>{index + 1}. {entry.title}</option>) : <option>Loading book…</option>}
      </select>
      <button aria-label="Next chapter" disabled={!book || chapter >= book.chapters.length - 1} onClick={() => setChapter((value) => value + 1)}><ChevronRight size={16} /></button>
      <span className="pdf-toolbar-spacer" />
      <button aria-label="Smaller text" disabled={zoom <= 0.75} onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))}><Minus size={16} /></button>
      <span>{Math.round(zoom * 100)}%</span>
      <button aria-label="Larger text" disabled={zoom >= 2} onClick={() => setZoom((value) => Math.min(2, value + 0.25))}><Plus size={16} /></button>
    </div>
    {error ? <p className="asset-message" role="alert">{error}</p> : html ? <iframe className="office-document-frame" title="EPUB chapter" sandbox="" srcDoc={isolatedPage(html, zoom)} /> : <p className="asset-message" role="status">Loading chapter…</p>}
  </div>;
}
