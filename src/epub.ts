import JSZip, { type JSZipObject } from "jszip";

export interface EpubChapter { path: string; title: string }
export interface EpubBook { title: string; chapters: EpubChapter[]; chapter: (index: number) => Promise<string> }
const MAX_FILE = 8 * 1024 * 1024;
const MAX_BOOK = 100 * 1024 * 1024;
function xml(text: string): Document {
  const parsed = new DOMParser().parseFromString(text, "application/xml");
  if (parsed.querySelector("parsererror")) throw new Error("This EPUB contains invalid book information.");
  return parsed;
}
function archivePath(base: string, href: string): string {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href) || href.includes("\\")) throw new Error("External EPUB resources are not supported.");
  const path = decodeURIComponent(href.split(/[?#]/)[0]);
  const parts = path.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) throw new Error("Invalid EPUB resource path."); parts.pop(); }
    else parts.push(part);
  }
  return parts.join("/");
}
interface BinaryStream {
  on(event: "data", callback: (chunk: Uint8Array) => void): BinaryStream;
  on(event: "error", callback: (error: Error) => void): BinaryStream;
  on(event: "end", callback: () => void): BinaryStream;
  pause(): BinaryStream; resume(): BinaryStream;
}
// JSZip exposes internalStream publicly, but omits it from its bundled typings.
// Read incrementally so compressed archive entries cannot grow without a bound.
async function bytes(file: JSZipObject, limit = MAX_FILE): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []; let length = 0;
    const stream = (file as JSZipObject & { internalStream(type: "uint8array"): BinaryStream }).internalStream("uint8array");
    stream.on("data", (chunk: Uint8Array) => {
      length += chunk.length;
      if (length > limit) { stream.pause(); reject(new Error("This EPUB resource exceeds the viewer size limit.")); return; }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => {
      const result = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      resolve(result);
    }).resume();
  });
}
const text = async (file: JSZipObject) => new TextDecoder().decode(await bytes(file));
function base64(data: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < data.length; offset += 8192) result += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return btoa(result);
}
export async function openEpub(data: string): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(data, { base64: true });
  if (Object.keys(zip.files).length > 20_000) throw new Error("This EPUB has too many resources to open.");
  let total = 0; const counted = new Set<string>();
  const read = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error("This EPUB is missing a required resource.");
    const result = await bytes(file);
    if (!counted.has(path)) { counted.add(path); total += result.length; }
    if (total > MAX_BOOK) throw new Error("This EPUB exceeds the reader memory limit.");
    return result;
  };
  const container = zip.file("META-INF/container.xml");
  if (!container) throw new Error("This file is not a supported EPUB book.");
  const packagePath = xml(await text(container)).getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
  if (!packagePath) throw new Error("This EPUB has no book manifest.");
  const packageXml = xml(new TextDecoder().decode(await read(archivePath("", packagePath))));
  const manifest = new Map(Array.from(packageXml.getElementsByTagNameNS("*", "item")).map((item) => [item.getAttribute("id"), {
    path: archivePath(packagePath, item.getAttribute("href") || ""), mime: item.getAttribute("media-type") || "",
  }]));
  const chapters = Array.from(packageXml.getElementsByTagNameNS("*", "itemref"))
    .filter((item) => item.getAttribute("linear") !== "no")
    .map((item) => manifest.get(item.getAttribute("idref")))
    .filter((item): item is { path: string; mime: string } => !!item && /^(application\/xhtml\+xml|text\/html)$/.test(item.mime))
    .map((item, index) => ({ path: item.path, title: `Chapter ${index + 1}` }));
  if (!chapters.length) throw new Error("This EPUB has no readable chapters. Encrypted books are not supported.");
  const encryption = zip.file("META-INF/encryption.xml");
  if (encryption) {
    const protectedPaths = Array.from(xml(await text(encryption)).getElementsByTagNameNS("*", "CipherReference"))
      .map((entry) => archivePath("", entry.getAttribute("URI") || ""));
    if (chapters.some((chapter) => protectedPaths.includes(chapter.path))) throw new Error("This EPUB is encrypted. Protected books cannot be opened.");
  }
  const title = packageXml.getElementsByTagNameNS("*", "title")[0]?.textContent?.trim() || "Book";
  return { title, chapters, async chapter(index) {
    const chapter = chapters[index];
    if (!chapter) throw new Error("This chapter is unavailable.");
    // A chapter is inert HTML in a sandbox. Keep text and embedded images only.
    const page = new DOMParser().parseFromString(new TextDecoder().decode(await read(chapter.path)), "text/html");
    chapter.title = page.querySelector("h1,h2,title")?.textContent?.trim() || chapter.title;
    page.querySelectorAll("script,style,link,iframe,object,embed,form,svg,math,video,audio,base,input,button").forEach((element) => element.remove());
    for (const element of page.body.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.name !== "src" && attribute.name !== "alt" && attribute.name !== "id" && attribute.name !== "colspan" && attribute.name !== "rowspan" && attribute.name !== "dir" && attribute.name !== "lang") element.removeAttribute(attribute.name);
      }
    }
    for (const image of page.querySelectorAll("img")) {
      try {
        const path = archivePath(chapter.path, image.getAttribute("src") || "");
        const resource = Array.from(manifest.values()).find((item) => item.path === path);
        if (!resource || !/^image\/(png|jpe?g|gif|webp|svg\+xml)$/.test(resource.mime)) throw new Error("Unsupported image");
        image.src = `data:${resource.mime};base64,${base64(await read(path))}`;
      } catch { image.replaceWith(page.createTextNode(`[Image: ${image.alt || "unavailable"}]`)); }
    }
    return page.body.innerHTML;
  }};
}
