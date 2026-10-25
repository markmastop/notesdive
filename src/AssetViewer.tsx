import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Grid2X2, Presentation } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Asset } from "./api";
import { EpubViewer } from "./EpubViewer";
import { isolatedPage } from "./isolatedPage";
import { PageToolbar } from "./PageToolbar";
import { invoke } from "@tauri-apps/api/core";
import { htmlLink } from "./htmlLinks";

function assetBytes(data: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
}

function HtmlViewer({ data, path, fragment, onOpen }: { data: string; path: string; fragment?: string; onOpen?: (path: string, fragment?: string) => void }) {
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const html = new TextDecoder().decode(assetBytes(data));
  const [page, setPage] = useState("");
  useEffect(() => { setPage(isolatedPage(html, 1, { fullWidth: true, linkNavigation: true })); }, [html]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "notesdive-html-link" || typeof event.data.href !== "string") return;
      setError("");
      const link = htmlLink(path, event.data.href);
      if (!link) { setError("This link does not point to a supported document or website."); return; }
      if ("web" in link) void invoke("open_web_link", { url: link.web }).catch(() => setError("Could not open this link in your browser."));
      else if (link.path === path) frame.current?.contentWindow?.postMessage({ type: "notesdive-html-scroll", id: link.fragment }, "*");
      else onOpen?.(link.path, link.fragment);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [path, onOpen]);
  return <div className="html-viewer">
    {error && <p className="link-error" role="alert">{error}</p>}
    {page && <iframe ref={frame} className="office-document-frame" title="HTML document" sandbox="allow-scripts" srcDoc={page} onLoad={() => {
      if (fragment) frame.current?.contentWindow?.postMessage({ type: "notesdive-html-scroll", id: fragment }, "*");
    }} />}
  </div>;
}

function DocxViewer({ data }: { data: string }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setHtml("");
    setError("");
    void import("mammoth").then((mammoth) => mammoth.convertToHtml({ arrayBuffer: assetBytes(data).buffer }, { externalFileAccess: false }))
      .then((result) => { if (alive) setHtml(result.value); })
      .catch((cause) => { if (alive) setError(`Could not display this Word document: ${String(cause)}`); });
    return () => { alive = false; };
  }, [data]);
  if (error) return <p className="asset-message" role="alert">{error}</p>;
  if (!html) return <p className="asset-message">Loading Word document…</p>;
  return <iframe className="office-document-frame" title="Word document" sandbox="" srcDoc={isolatedPage(html)} />;
}

function PptxViewer({ data }: { data: string }) {
  const [slides, setSlides] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [grid, setGrid] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setSlides([]);
    setIndex(0);
    setError("");
    void Promise.all([import("@office-kit/pptx"), import("@office-kit/pptx-preview")])
      .then(async ([pptx, preview]) => {
        const presentation = await pptx.loadPresentation(assetBytes(data));
        return pptx.getSlides(presentation).map((slide) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.renderSlideToSvg(presentation, slide))}`);
      })
      .then((next) => { if (alive) setSlides(next); })
      .catch((cause) => { if (alive) setError(`Could not display this presentation: ${String(cause)}`); });
    return () => { alive = false; };
  }, [data]);
  useEffect(() => {
    if (grid) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]")) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") setIndex((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight" || event.key === "PageDown") setIndex((current) => Math.min(slides.length - 1, current + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [grid, slides.length]);
  return <div className="office-slides" aria-label="PowerPoint viewer">
    <div className="pdf-toolbar">
      <button aria-label="Previous slide" disabled={grid || index === 0} onClick={() => setIndex(index - 1)}><ChevronLeft size={16} /></button>
      <span>Slide {slides.length ? index + 1 : 0} of {slides.length || "…"}</span>
      <button aria-label="Next slide" disabled={grid || index >= slides.length - 1} onClick={() => setIndex(index + 1)}><ChevronRight size={16} /></button>
      <span className="pdf-toolbar-spacer" />
      <button aria-label="Show slide grid" aria-pressed={grid} onClick={() => setGrid(true)}><Grid2X2 size={16} /></button>
      <button aria-label="Show single slide" aria-pressed={!grid} onClick={() => setGrid(false)}><Presentation size={16} /></button>
    </div>
    {error ? <p className="asset-message" role="alert">{error}</p> : !slides.length ? <p className="asset-message">Loading presentation…</p> : grid ?
      <div className="office-slide-grid">{slides.map((src, number) => <button key={number} onClick={() => { setIndex(number); setGrid(false); }} aria-label={`Open slide ${number + 1}`}><img src={src} alt={`Slide ${number + 1}`} /><span>{number + 1}</span></button>)}</div> :
      <div className="office-slide-stage"><img src={slides[index]} alt={`Slide ${index + 1}`} /></div>}
  </div>;
}

function PdfViewer({ data }: { data: string }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(640);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | null = null;
    setDocument(null);
    setPageNumber(1);
    setError("");
    void import("pdfjs-dist")
      .then((pdfjs) => {
        if (!alive) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        task = pdfjs.getDocument({ data: bytes });
        return task.promise;
      })
      .then((pdf) => {
        if (alive && pdf) setDocument(pdf);
      })
      .catch((cause) => {
        if (alive) setError(`Could not display this PDF: ${String(cause)}`);
      });
    return () => {
      alive = false;
      if (task) void task.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let alive = true;
    let rendering: RenderTask | null = null;
    setError("");
    void document.getPage(pageNumber).then((page) => {
      if (!alive || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.25, (Math.max(width - 48, 280) / base.width) * zoom);
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
      );
      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      rendering = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      return rendering.promise;
    }).catch((cause) => {
      if (alive && (cause as { name?: string }).name !== "RenderingCancelledException")
        setError(`Could not render this page: ${String(cause)}`);
    });
    return () => {
      alive = false;
      rendering?.cancel();
    };
  }, [document, pageNumber, width, zoom]);

  return (
    <div className="pdf-viewer" aria-label="PDF viewer">
      <PageToolbar page={pageNumber} count={document?.numPages ?? null} zoom={zoom} onPage={setPageNumber} onZoom={setZoom} />
      <div className="pdf-scroll" ref={scrollRef}>
        {error ? <p className="asset-message" role="alert">{error}</p> : document ? <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} /> : <p className="asset-message">Loading PDF…</p>}
      </div>
    </div>
  );
}

export function AssetViewer({ asset, onChapterChange, onOpen, fragment }: { asset: Asset; onChapterChange?: (index: number) => void; onOpen?: (path: string, fragment?: string) => void; fragment?: string }) {
  if (asset.mime === "application/epub+zip") return <EpubViewer data={asset.data} onChapterChange={onChapterChange} />;
  if (asset.mime === "text/plain") return <div className="text-viewer" aria-label="Text viewer"><pre>{new TextDecoder().decode(assetBytes(asset.data))}</pre></div>;
  if (asset.mime === "application/pdf") return <PdfViewer data={asset.data} />;
  if (asset.mime === "text/html") return <HtmlViewer key={asset.path} data={asset.data} path={asset.path} onOpen={onOpen} fragment={fragment} />;
  if (asset.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return <DocxViewer data={asset.data} />;
  if (asset.mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return <PptxViewer data={asset.data} />;
  return (
    <div className="image-viewer">
      <img src={`data:${asset.mime};base64,${asset.data}`} alt={asset.path.split("/").pop() || "Image"} />
    </div>
  );
}
