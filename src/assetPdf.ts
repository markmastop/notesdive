import type { Asset } from "./api";
import { exportPdf, saveOriginalPdf, savePdfDefinition } from "./pdfExport";

/** Export the entire selected file, independently of the viewer's current page. */
export async function exportAssetPdf(asset: Asset, signal?: AbortSignal) {
  const name = asset.path.split("/").pop()!;
  signal?.throwIfAborted();
  if (asset.mime === "application/pdf") return saveOriginalPdf(name, asset.data, signal);
  if (/\.epub$/i.test(asset.path)) {
    const { exportEpubPdf } = await import("./epubPdf");
    return exportEpubPdf({ data: asset.data, name, chapter: null, signal, progress: () => {} });
  }
  const bytes = Uint8Array.from(atob(asset.data), (char) => char.charCodeAt(0));
  if (/\.pptx$/i.test(asset.path)) {
    const [pptx, preview] = await Promise.all([import("@office-kit/pptx"), import("@office-kit/pptx-preview")]);
    const deck = await pptx.loadPresentation(bytes);
    const content = [];
    let total = 0;
    let width = 960, height = 540;
    for (const slide of pptx.getSlides(deck)) {
      signal?.throwIfAborted();
      const svg = preview.renderSlideToSvg(deck, slide);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      width = image.naturalWidth * 0.75; height = image.naturalHeight * 0.75;
      const scale = Math.min(2, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth * scale; canvas.height = image.naturalHeight * scale;
      canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/png");
      total += data.length;
      if (total > 100 * 1024 * 1024) throw new Error("This presentation is too large to export at once. Split it into smaller decks.");
      content.push({ image: data, width, height, ...(content.length ? { pageBreak: "before" as const } : {}) });
      canvas.width = canvas.height = 0;
    }
    if (!content.length) throw new Error("This presentation has no slides to export.");
    const generatedAt = new Date();
    return savePdfDefinition({ pageSize: { width, height }, pageMargins: 0, content,
      info: { title: name, creator: "NotesDive", creationDate: generatedAt },
    }, name, generatedAt, signal, false);
  }
  const source = document.createElement("article");
  const template = document.createElement("template");
  if (/\.docx$/i.test(asset.path)) {
    const mammoth = await import("mammoth");
    template.innerHTML = (await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, { externalFileAccess: false })).value;
  } else if (/\.html?$/i.test(asset.path)) {
    template.innerHTML = new TextDecoder().decode(bytes);
  } else if (asset.mime === "text/plain") {
    const text = document.createElement("pre");
    text.textContent = new TextDecoder().decode(bytes);
    source.append(text);
  } else if (asset.mime.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = `data:${asset.mime};base64,${asset.data}`; image.alt = name;
    source.append(image);
  } else throw new Error("PDF export is not available for this file type.");
  // Keep HTML inert until external URLs and executable markup have been removed.
  template.content.querySelectorAll("script, style, link, base, meta, iframe, frame, frameset, object, embed, svg, audio, video, source, input, select, textarea").forEach((element) => element.remove());
  template.content.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("on") || ["style", "srcset", "background"].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
  });
  template.content.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    if (!/^data:image\/(png|jpeg|jpg|svg\+xml)[;,]/i.test(image.getAttribute("src") || "")) image.removeAttribute("src");
  });
  source.append(template.content);
  return exportPdf({ title: name.replace(/\.[^.]+$/, ""), documentName: name, source, signal });
}
