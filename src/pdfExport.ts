import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./api";
import { renderMarkdown } from "./markdown";
import { localImageData } from "./localImages";
import { pdfFilename } from "./pdfFilename";
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";

// Convert a detached snapshot into a real PDF; no print dialog or external service.
export async function exportPdf(options: {
  title: string;
  documentName?: string;
  markdown?: string;
  folder?: string;
  notePath?: string;
  source: HTMLElement | null;
  signal?: AbortSignal;
}) {
  const root = document.createElement("article");

  const heading = document.createElement("h1");
  heading.textContent = options.title;
  const content = document.createElement("div");
  if (options.markdown !== undefined) {
    content.innerHTML = renderMarkdown(options.markdown);
    if (options.folder && options.notePath) {
      await Promise.all(Array.from(content.querySelectorAll<HTMLElement>("[data-local-image]")).map(async (placeholder) => {
        const data = await localImageData(options.folder!, options.notePath!, placeholder.dataset.localImage || "");
        if (!data) return;
        const image = document.createElement("img");
        image.src = data;
        image.alt = placeholder.dataset.imageAlt || "Image";
        placeholder.replaceChildren(image);
      }));
    }
  } else {
    if (!options.source) throw new Error("No page available to export.");
    content.append(options.source.cloneNode(true));
    // Isolated Office/HTML frames are represented by their inert source HTML.
    content.querySelectorAll<HTMLIFrameElement>("iframe").forEach((frame) => {
      const parsed = new DOMParser().parseFromString(frame.srcdoc, "text/html");
      const section = document.createElement("section");
      section.append(...Array.from(parsed.body.childNodes));
      frame.replaceWith(section);
    });
    content.querySelectorAll("[aria-hidden]").forEach((element) => element.removeAttribute("aria-hidden"));
    // PDF and presentation previews use canvases. Copy their pixels into the snapshot.
    const originals = options.source.querySelectorAll("canvas");
    content.querySelectorAll("canvas").forEach((canvas, index) => {
      const image = document.createElement("img");
      image.src = originals[index].toDataURL();
      image.alt = originals[index].getAttribute("aria-label") || "Preview";
      canvas.replaceWith(image);
    });
    content.querySelectorAll("button").forEach((button) => {
      if (button.classList.contains("icon-button") || button.closest(".page-heading, .topbar-actions, .notes-reader-header")) button.remove();
      else {
        const label = document.createElement("span");
        label.append(...Array.from(button.childNodes));
        button.replaceWith(label);
      }
    });
    content.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((input) => input.replaceWith(document.createTextNode(input.checked ? "[x] " : "[ ] ")));
    content.querySelectorAll(".todo-controls, .task-documents, .notes-folder-panel, .document-footer, .pdf-toolbar, .marp-controls, .notes-reader-header").forEach((element) => element.remove());
    content.querySelectorAll("[data-todo-export]").forEach((element) => element.classList.remove("pdf-export-source"));
    // The todo export source itself must remain visible in the snapshot.
    if (options.source.hasAttribute("data-todo-export")) {
      const clone = content.firstElementChild!;
      clone.classList.remove("pdf-export-source");
    }
  }
  if (!content.querySelector("h1")) root.append(heading);
  root.append(content);
  // Drop executable markup, layout styles and remote images from untrusted files.
  root.querySelectorAll("script, style, link, object, embed, svg, input, select, textarea").forEach((element) => element.remove());
  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    element.removeAttribute("style");
    element.removeAttribute("class");
    element.removeAttribute("data-pdfmake");
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith("on")) element.removeAttribute(attribute.name);
    }
  });
  root.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
    if (!/^https?:\/\//i.test(link.getAttribute("href") || "")) link.removeAttribute("href");
  });
  await Promise.all(Array.from(root.querySelectorAll<HTMLImageElement>("img")).map(async (image) => {
    if (!/^data:image\/(png|jpeg|jpg|svg\+xml)[;,]/i.test(image.src)) {
      image.replaceWith(document.createTextNode(`[Image: ${image.alt || "unavailable"}]`));
      return;
    }
    try {
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      image.src = canvas.toDataURL("image/png");
      image.setAttribute("data-pdfmake", JSON.stringify({ fit: [490, 650] }));
    } catch { image.replaceWith(document.createTextNode(`[Image: ${image.alt || "unavailable"}]`)); }
  }));
  let wideTable = false;
  root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    heading.id = `pdf-heading-${index}`;
  });
  root.querySelectorAll<HTMLElement>("blockquote").forEach((quote) => {
    quote.setAttribute("data-pdfmake", JSON.stringify({ margin: [14, 6, 0, 14], color: "#796754", italics: true }));
  });
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    if (!table.rows.length) { table.remove(); return; }
    const columns = Math.max(...Array.from(table.rows).map((row) => Array.from(row.cells).reduce((sum, cell) => sum + cell.colSpan, 0)));
    if (columns > 5) {
      wideTable = true;
      table.style.fontSize = "9pt";
    }
    table.setAttribute("data-pdfmake", JSON.stringify({ widths: Array(columns).fill("*"), headerRows: table.tHead?.rows.length || (table.rows[0]?.querySelector("th") ? 1 : 0), layout: "lightHorizontalLines" }));
  });
  const { default: htmlToPdfmake } = await import("html-to-pdfmake");
  const generatedAt = new Date();
  const documentName = options.documentName || options.notePath?.split("/").pop() || options.title;
  const definition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: wideTable ? "landscape" : "portrait",
    pageMargins: [51, 51, 51, 65],
    info: { title: documentName, creator: "NotesDive", creationDate: generatedAt },
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.35, color: "#4f4437" },
    pageBreakBefore: (node, queries) => Boolean(node.id?.startsWith("pdf-heading-") && !queries.getFollowingNodesOnPage().length && queries.getNodesOnNextPage().length),
    content: htmlToPdfmake(root.innerHTML, {
      removeExtraBlanks: true,
      defaultStyles: {
        h1: { fontSize: 25, bold: true, color: "#243b45", margin: [0, 0, 0, 18] },
        h2: { fontSize: 17, bold: true, color: "#243b45", margin: [0, 18, 0, 9] },
        h3: { fontSize: 13, bold: true, color: "#243b45", margin: [0, 14, 0, 7] },
        h4: { fontSize: 11.5, bold: true, margin: [0, 12, 0, 6] },
        h5: { fontSize: 11, bold: true, margin: [0, 10, 0, 5] },
        h6: { fontSize: 10.5, bold: true, margin: [0, 10, 0, 5] },
        p: { margin: [0, 0, 0, 10] },
        a: { color: "#9b5a2f", decoration: "underline" },
        code: { fontSize: 9, background: "#f4f1ec" },
        pre: { fontSize: 9, margin: [0, 5, 0, 12], preserveLeadingSpaces: true },
        ul: { margin: [0, 0, 0, 10] },
        ol: { margin: [0, 0, 0, 10] },
        th: { bold: true, color: "#243b45", fillColor: "#eef2f3", margin: [5, 6, 5, 6] },
        td: { margin: [5, 5, 5, 5] },
      },
    }),
  };
  return savePdfDefinition(definition, documentName, generatedAt, options.signal);
}

export async function savePdfDefinition(definition: TDocumentDefinitions, documentName: string, generatedAt: Date, signal?: AbortSignal, footer = true) {
  signal?.throwIfAborted();
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"), import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const timestamp = new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    timeZoneName: "short",
  }).format(generatedAt);
  if (footer) definition.footer = (page, count, size) => ({
    margin: [51, 10, 51, 0], fontSize: 8, color: "#877b6f",
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: size.width - 102, y2: 0, lineWidth: 0.5, lineColor: "#ddd6cc" }], margin: [0, 0, 0, 8] },
      { columns: [
        { text: documentName.length > 70 ? `${documentName.slice(0, 67)}…` : documentName, width: "*" },
        { text: `${timestamp}  ·  ${page}/${count}`, width: "auto", alignment: "right" },
      ] },
    ],
  });
  const pdf = pdfMake.createPdf(definition);
  const filename = pdfFilename(documentName, generatedAt);
  if (desktop) {
    const data = await pdf.getBase64();
    signal?.throwIfAborted();
    return invoke<string | null>("save_pdf", { filename, data });
  }
  signal?.throwIfAborted();
  await pdf.download(filename);
  return filename;
}

/** One vector page per notebook page; reuse the normal PDF footer/save dialog. */
export async function exportNotebookPdf(options: { name: string; pages: AsyncIterable<{ svg: string; width: number; height: number }>; signal?: AbortSignal }) {
  const content: Content[] = [];
  let total = 0;
  for await (const page of options.pages) {
    options.signal?.throwIfAborted();
    total += page.svg.length;
    if (total > 100 * 1024 * 1024) throw new Error("This notebook is too large to export at once. Export individual pages instead.");
    // SVG-to-PDF uses these explicit dimensions to preserve each page's aspect.
    const svg = page.svg.replace(/<\?xml[^>]*>\s*/, "").replace(/<svg /, `<svg width="${page.width}" height="${page.height}" `);
    content.push({ svg, fit: [490, 700], ...(content.length ? { pageBreak: "before" as const } : {}) });
  }
  if (!content.length) throw new Error("This notebook has no pages to export.");
  const generatedAt = new Date();
  return savePdfDefinition({ pageSize: "A4", pageMargins: [51, 51, 51, 65], content,
    info: { title: options.name, creator: "NotesDive", creationDate: generatedAt },
    defaultStyle: { font: "Roboto" },
  }, options.name, generatedAt, options.signal);
}

export async function saveOriginalPdf(name: string, data: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const filename = pdfFilename(name, new Date());
  if (desktop) return invoke<string | null>("save_pdf", { filename, data });
  const link = document.createElement("a"); link.href = `data:application/pdf;base64,${data}`; link.download = filename; link.click();
  return filename;
}
