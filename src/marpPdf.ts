import type { Content } from "pdfmake/interfaces";
import { renderMarp } from "./marp";
import { builtinMarpThemes, loadMarpTheme } from "./marpThemes";
import { localMarpBackground } from "./marpStyles";
import { localImageData } from "./localImages";
import { savePdfDefinition } from "./pdfExport";

/** Render every slide at its own size in an isolated, offline document. */
export async function exportMarpPdf(options: {
  text: string; folder: string; notePath: string; library: string | null; signal?: AbortSignal;
}) {
  const images = new Map<string, Promise<string>>();
  const pdfImage = (data: string): Promise<string> => {
    if (!/^data:image\/svg\+xml[;,]/i.test(data)) return Promise.resolve(data);
    if (!images.has(data)) images.set(data, (async () => {
      // WebKit taints canvas patterns backed by SVG images. Rasterize them in
      // the main document before html2canvas paints themed slide backgrounds.
      const image = new Image();
      image.src = data;
      await image.decode();
      const scale = Math.min(2, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, image.naturalWidth * scale); canvas.height = Math.max(1, image.naturalHeight * scale);
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL("image/png");
      canvas.width = canvas.height = 0;
      return png;
    })());
    return images.get(data)!;
  };
  let deck = renderMarp(options.text);
  if (!builtinMarpThemes.has(deck.theme)) {
    const theme = await loadMarpTheme(options.folder, options.notePath, deck.theme, options.library);
    if (theme.warning) throw new Error(theme.warning);
    const artwork = new Map(await Promise.all(Array.from(theme.images, async ([source, data]) => [source, await pdfImage(data)] as const)));
    deck = renderMarp(options.text, theme.css, artwork);
  }
  if (!deck.slides.length) throw new Error("This presentation has no slides to export.");
  // Bound the canvas size even for user-defined slide dimensions.
  const scale = Math.min(2, 4096 / Math.max(deck.width, deck.height));
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("Invalid presentation size.");
  const { default: html2canvas } = await import("html2canvas");
  options.signal?.throwIfAborted();
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-100000px;top:0;width:${deck.width}px;height:${deck.height}px;border:0;pointer-events:none`;
  // No document code or external resources are allowed into the export frame.
  frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"></head><body></body></html>';
  const content: Content[] = [];
  let total = 0;
  const read = async (source: string) => {
    const data = await localImageData(options.folder, options.notePath, source);
    return data ? pdfImage(data) : null;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Could not prepare the presentation export.")), 5000);
      frame.onload = () => { clearTimeout(timeout); resolve(); };
      document.body.append(frame);
    });
    const doc = frame.contentDocument!;
    const style = doc.createElement("style");
    style.textContent = `${deck.css}\nhtml,body{margin:0;padding:0;background:white}div.marpit{width:${deck.width}px;height:${deck.height}px}.image-placeholder{border:1px dashed currentColor;padding:.25em .5em;font-size:.6em;opacity:.7}`;
    doc.head.append(style);
    const surface = doc.createElement("div");
    surface.className = "marpit";
    doc.body.append(surface);
    for (const [index, slide] of deck.slides.entries()) {
      options.signal?.throwIfAborted();
      surface.innerHTML = slide.html;
      await Promise.all(Array.from(surface.querySelectorAll<HTMLImageElement>("img[data-marp-image]")).map(async (image) => {
        const data = await read(image.dataset.marpImage || "");
        if (data) { image.src = data; await image.decode(); }
        else {
          const label = doc.createElement("span");
          label.className = "image-placeholder";
          label.textContent = `[Image: ${image.alt || "unavailable"}]`;
          image.replaceWith(label);
        }
      }));
      await Promise.all(Array.from(surface.querySelectorAll<HTMLElement>("[data-marp-background]")).map(async (element) => {
        element.style.backgroundImage = await localMarpBackground(element.dataset.marpBackground || "", read);
      }));
      await doc.fonts.ready;
      options.signal?.throwIfAborted();
      const canvas = await html2canvas(surface, {
        scale, width: deck.width, height: deck.height, windowWidth: deck.width, windowHeight: deck.height,
        backgroundColor: "#ffffff", logging: false, allowTaint: false, useCORS: false,
      }).catch((error) => { throw new Error(`Could not render slide ${index + 1}: ${String(error)}`); });
      let image: string;
      try { image = canvas.toDataURL("image/png"); }
      catch (error) { throw new Error(`Could not encode slide ${index + 1}: ${String(error)}`); }
      canvas.width = canvas.height = 0;
      total += image.length;
      if (total > 100 * 1024 * 1024) throw new Error("This presentation is too large to export at once. Split it into smaller decks.");
      content.push({ image, width: deck.width * 0.75, height: deck.height * 0.75, ...(index ? { pageBreak: "before" as const } : {}) });
    }
  } finally { frame.remove(); }
  const name = options.notePath.split("/").pop()!;
  const generatedAt = new Date();
  // Full-bleed pages preserve the deck's aspect ratio, headers and pagination.
  return savePdfDefinition({
    pageSize: { width: deck.width * 0.75, height: deck.height * 0.75 }, pageMargins: 0, content,
    info: { title: name, creator: "NotesDive", creationDate: generatedAt },
  }, name, generatedAt, options.signal, false);
}
