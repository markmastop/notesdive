import { fileKind } from "./fileTypes";
import { webUrl } from "./webLinks";

export function htmlLink(source: string, href: string): { web: string } | { path: string; fragment: string } | null {
  const value = href.trim();
  if (!value || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  const web = webUrl(value.startsWith("//") ? `https:${value}` : value);
  if (web) return { web };
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  try {
    const [resource, ...hash] = value.split("#");
    const fragment = decodeURIComponent(hash.join("#"));
    const rawPath = decodeURIComponent(resource.split("?")[0]);
    if (/[\u0000-\u001f\u007f\\]/.test(rawPath)) return null;
    if (!rawPath) return { path: source, fragment };
    const parts = rawPath.startsWith("/") ? [] : source.split("/").slice(0, -1);
    for (const part of rawPath.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!parts.length) return null; parts.pop(); }
      else parts.push(part);
    }
    const path = parts.join("/");
    return fileKind(path) ? { path, fragment } : null;
  } catch { return null; }
}
