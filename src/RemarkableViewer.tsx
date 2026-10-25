import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { exportNotebookPdf, saveOriginalPdf } from "./pdfExport";
import { exportEpubPdf } from "./epubPdf";
import { renderRmPreview } from "./rmWorker";
import { AssetViewer } from "./AssetViewer";
import { PageToolbar } from "./PageToolbar";
import { remarkableApi, type RemarkableDetail, type RemarkablePreview } from "./remarkable";
import type { RenderedRmPage } from "./rmRender";

// Each selected document owns its preview. No notebook pages are written to disk
// or downloaded ahead of the page the user has chosen.
export function RemarkableViewer({ id, name, detail, initialPage = 1, exportTarget }: { id: string; name: string; detail: RemarkableDetail; initialPage?: number; exportTarget?: HTMLElement | null }) {
  const [page, setPage] = useState(Math.max(1, Math.min(initialPage, detail.pages.length || 1)));
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(640);
  const [rendered, setRendered] = useState<RenderedRmPage | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);
  const [epubChapter, setEpubChapter] = useState(0);
  const [scope, setScope] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportProgress, setExportProgress] = useState("");
  const exportController = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const previewRequest = useRef<{ key: string; promise: Promise<RemarkablePreview> } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const notebook = detail.fileType === "notebook";
  const epub = detail.fileType === "epub";
  const supported = notebook || detail.fileType === "pdf" || epub;
  useEffect(() => () => exportController.current?.abort(), []);
  const count = detail.pages.length;

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [notebook]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setRendered(null); setPdf(null); setError("");
    scroll.current?.scrollTo(0, 0);
    if (!supported || (notebook && count === 0)) return;
    const key = `${id}:${notebook ? page : "pdf"}:${retry}`;
    // Reuse the current request when React remounts the effect in development.
    if (previewRequest.current?.key !== key) previewRequest.current = { key, promise: remarkableApi.preview(id, notebook ? page - 1 : null) };
    void previewRequest.current.promise.then(async (asset) => {
      if (!alive) return;
      if (!notebook) {
        if (asset.mime !== (epub ? "application/epub+zip" : "application/pdf") || !asset.data) throw new Error("This document has no original file to display.");
        setPdf(asset.data); return;
      }
      if (asset.mime !== "application/x-remarkable") throw new Error("Unexpected notebook page format.");
      const result = await renderRmPreview(asset.data, controller.signal);
      if (alive) setRendered(result);
    }).catch((cause) => { if (alive) setError(String(cause)); });
    return () => { alive = false; controller.abort(); };
  }, [id, page, notebook, epub, supported, count, retry]);

  const exportDocument = async () => {
    const controller = new AbortController(); exportController.current = controller;
    setExporting(true); setExportError(""); setExportProgress("");
    try {
      if (notebook) {
        const indices = scope === "current" ? [page - 1] : Array.from({ length: count }, (_, index) => index);
        const pages = async function* () {
          let loaded = 0;
          for (const index of indices) {
            controller.signal.throwIfAborted();
            const result = index === page - 1 && rendered ? rendered
              : await renderRmPreview((await remarkableApi.preview(id, index)).data, controller.signal);
            setExportProgress(`${++loaded} / ${indices.length}`);
            yield result;
          }
        };
        await exportNotebookPdf({ name: scope === "current" ? `${name} - page ${page}` : name, pages: pages(), signal: controller.signal });
      } else if (pdf && epub) {
        await exportEpubPdf({ data: pdf, name: scope === "current" ? `${name} - chapter ${epubChapter + 1}` : name, chapter: scope === "current" ? epubChapter : null, signal: controller.signal,
          progress: (loaded, total) => setExportProgress(`${loaded} / ${total}`) });
      } else if (pdf) await saveOriginalPdf(name, pdf, controller.signal);
    } catch (cause) { if (!controller.signal.aborted) setExportError(String(cause)); }
    finally { if (exportController.current === controller) { setExporting(false); exportController.current = null; } }
  };
  const exportControls =
    <div className="remarkable-export-controls">
      {(notebook || epub) && <select aria-label="PDF export scope" value={scope} disabled={exporting} onChange={(event) => setScope(event.target.value)}>
        <option value="all">Whole document</option><option value="current">{epub ? "Current chapter" : "Current page"}</option>
      </select>}
      <button className="quiet-button document-pdf-button" aria-label="Export PDF" title="Download this document as PDF" disabled={exporting || (notebook ? !rendered || !!error || count === 0 : !pdf)} onClick={() => void exportDocument()}><Download size={14} />{exporting ? `Preparing… ${exportProgress}` : "PDF"}</button>
      {exporting && <button className="icon-button" aria-label="Cancel PDF export" onClick={() => exportController.current?.abort()}><X size={14} /></button>}
    </div>;
  const exportHeader = <>{exportTarget ? createPortal(exportControls, exportTarget) : exportTarget === undefined ? exportControls : null}
    {exportError && <p className="list-warning" role="alert">{exportError}</p>}</>;
  const message = error ? <div className="asset-message" role="alert"><p>{error}</p><button className="quiet-button" onClick={() => setRetry((value) => value + 1)}>Retry preview</button></div>
    : <p className="asset-message" role="status">{notebook && count === 0 ? "This notebook has no pages." : "Loading preview…"}</p>;
  if (!supported) return <p className="asset-message">Preview is not available for {detail.fileType.toUpperCase()} documents yet.</p>;
  if (!notebook) return <div className="remarkable-preview-pane">
    {exportHeader}
    {pdf ? <AssetViewer asset={{ path: `${name}.${epub ? "epub" : "pdf"}`, mime: epub ? "application/epub+zip" : "application/pdf", data: pdf }} onChapterChange={setEpubChapter} /> : message}
    <p className="remarkable-viewer-note">{epub ? "Original EPUB · reMarkable annotations are not included." : "Original PDF · reMarkable annotations are not included."}</p>
  </div>;
  const displayWidth = Math.max(width - 48, 200) * zoom;
  return <div className="pdf-viewer rm-viewer" aria-label="reMarkable notebook viewer">
    {exportHeader}
    <PageToolbar page={page} count={count} zoom={zoom} onPage={setPage} onZoom={setZoom} />
    <div className="pdf-scroll" ref={scroll}>
      {rendered && !error ? <img className="rm-page" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered.svg)}`} alt={`Notebook page ${page}`}
        style={{ width: displayWidth, height: displayWidth * rendered.height / rendered.width }} onError={() => setError("Could not display this notebook page.")} /> : message}
    </div>
    <p className="remarkable-viewer-note">Notebook preview · paper templates are not included.</p>
  </div>;
}
