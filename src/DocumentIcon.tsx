import { fileKind } from "./fileTypes";

const types = {
  markdown: { name: "Markdown", badge: "", color: "#778774" },
  html: { name: "HTML", badge: "HTML", color: "#b36b37" },
  pdf: { name: "PDF", badge: "PDF", color: "#b25555" },
  epub: { name: "EPUB", badge: "EPUB", color: "#81669f" },
  text: { name: "Text", badge: "TXT", color: "#667984" },
  docx: { name: "Word", badge: "DOCX", color: "#527bb0" },
  pptx: { name: "PowerPoint", badge: "PPTX", color: "#b86c3c" },
  image: { name: "Image", badge: "IMG", color: "#49867f" },
};

/** Source takes precedence over extension for read-only reMarkable documents. */
export function DocumentIcon({ path, remarkable = false, size = 24 }: { path: string; remarkable?: boolean; size?: number }) {
  const kind = fileKind(path);
  const type = remarkable ? { name: "reMarkable", badge: "rm", color: "#555f59" }
    : kind ? types[kind] : { name: "File", badge: "", color: "#778774" };
  const badge = kind === "image" && !remarkable ? path.split(".").pop()!.toUpperCase().replace("JPEG", "JPG") : type.badge;
  return <svg className="document-kind-icon" role="img" aria-label={`${type.name} document`} viewBox="0 0 26 30"
    style={{ width: size, height: size * 30 / 26, flexShrink: 0, color: type.color }}>
    <title>{type.name} document</title>
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {remarkable ? <><rect x="5" y="1" width="16" height="26" rx="2" /><path d="M17 5v11M16 16l1 2 1-2" /></>
        : <><path d="M5 1h10l6 6v20H5zM15 1v7h6" />
          {kind === "image" ? <><circle cx="10" cy="12" r="1.5" /><path d="m7 20 4-5 3 3 3-4 3 6" /></>
            : kind === "html" ? <path d="m10 11-3 3 3 3m6-6 3 3-3 3m-2-7-2 8" />
              : <path d="M8 12h10M8 16h10M8 20h7" />}</>}
    </g>
    {badge && <><rect x="1" y="21" width="24" height="9" rx="2" fill="currentColor" />
      <text x="13" y="27.7" textAnchor="middle" fill="#fff" fontSize={badge === "rm" ? "9" : "7"} fontWeight="700" fontFamily="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">{badge}</text></>}
  </svg>;
}
