import { Children, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

const storageKey = "notesdive:project-folder-width";

export function ResizableFileBrowser({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [available, setAvailable] = useState(600);
  const [preferred, setPreferred] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= 125 ? saved : 210;
    } catch { return 210; }
  });
  const maximum = Math.max(125, available - 192);
  const width = Math.min(maximum, Math.max(125, preferred));
  const resize = (value: number) => {
    const next = Math.round(Math.min(maximum, Math.max(125, value)));
    setPreferred(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Keep resizing available without storage. */ }
  };
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailable(element.clientWidth));
    setAvailable(element.clientWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const panes = Children.toArray(children);
  return <div ref={container} className="project-file-browser" style={{ "--folder-width": `${width}px` } as CSSProperties}>
    {panes[0]}
    <div className="project-tree-resizer" role="separator" tabIndex={0}
      aria-label="Resize project folder pane" aria-orientation="vertical"
      aria-valuemin={125} aria-valuemax={maximum} aria-valuenow={width}
      title="Drag to resize folders. Use arrow keys to adjust; double-click to reset."
      data-dragging={dragging}
      onDoubleClick={() => resize(210)}
      onKeyDown={(event) => {
        const next = event.key === "ArrowLeft" ? width - 20 : event.key === "ArrowRight" ? width + 20 : event.key === "Home" ? 125 : event.key === "End" ? maximum : null;
        if (next !== null) { event.preventDefault(); resize(next); }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
        setDragging(true);
      }}
      onPointerMove={(event) => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x); }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        drag.current = null; setDragging(false);
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
    />
    {panes.slice(1)}
  </div>;
}
