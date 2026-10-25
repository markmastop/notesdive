import { api } from "./api";

export function localImagePath(notePath: string, source: string): string | null {
  if (!source || source.startsWith("/") || source.includes("\\") || /[?#]/.test(source) || /^[a-z][a-z\d+.-]*:/i.test(source)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(source); } catch { return null; }
  if (decoded.includes("\\") || decoded.startsWith("/") || /[?#\u0000-\u001f]/.test(decoded)) return null;
  const parts = notePath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  const path = parts.join("/");
  return /\.(svg|png|jpe?g)$/i.test(path) ? path : null;
}

export async function localImageData(folder: string, notePath: string, source: string): Promise<string | null> {
  const path = localImagePath(notePath, source);
  if (!path) return null;
  try {
    const asset = await api.readAsset(folder, path);
    return asset.mime.startsWith("image/") ? `data:${asset.mime};base64,${asset.data}` : null;
  } catch { return null; }
}

export function showLocalImages(container: HTMLElement, folder: string, notePath: string): () => void {
  let active = true;
  for (const placeholder of container.querySelectorAll<HTMLElement>("[data-local-image]")) {
    const source = placeholder.dataset.localImage || "";
    void localImageData(folder, notePath, source).then((data) => {
      if (!active || !data) return;
      const image = document.createElement("img");
      image.src = data;
      image.alt = placeholder.dataset.imageAlt || "Image";
      image.loading = "lazy";
      placeholder.replaceChildren(image);
      placeholder.classList.add("loaded");
    });
  }
  return () => { active = false; };
}
