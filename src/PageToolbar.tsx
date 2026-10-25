import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";

/** Shared page navigation and fit-width zoom for PDF and reMarkable previews. */
export function PageToolbar({ page, count, zoom, onPage, onZoom }: {
  page: number; count: number | null; zoom: number;
  onPage: (page: number) => void; onZoom: (zoom: number) => void;
}) {
  return <div className="pdf-toolbar">
    <button aria-label="Previous page" disabled={!count || page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></button>
    <span>Page {count === 0 ? 0 : page} of {count ?? "…"}</span>
    <button aria-label="Next page" disabled={!count || page >= count} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></button>
    <span className="pdf-toolbar-spacer" />
    <button aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => onZoom(Math.max(0.5, zoom - 0.25))}><Minus size={16} /></button>
    <span>{Math.round(zoom * 100)}%</span>
    <button aria-label="Zoom in" disabled={zoom >= 3} onClick={() => onZoom(Math.min(3, zoom + 0.25))}><Plus size={16} /></button>
  </div>;
}
