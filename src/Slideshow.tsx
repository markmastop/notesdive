import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

export type PresentationSession = Promise<(() => Promise<void>) | null>;

export function Slideshow({ session, count, current, onNavigate, onClose, onError, onRestoreFocus, children }: {
  session: PresentationSession; count: number; current: number; onNavigate: (index: number) => void;
  onClose: () => void; onError: (message: string) => void; onRestoreFocus: () => void; children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const activeSession = useRef<PresentationSession | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [controlsVisible, setControlsVisible] = useState(true);
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 2000);
  }, []);
  useEffect(() => {
    activeSession.current = session;
    const app = document.getElementById("root");
    const wasInert = app?.inert || false;
    const ariaHidden = app?.getAttribute("aria-hidden") ?? null;
    const overflow = document.body.style.overflow;
    if (app) { app.inert = true; app.setAttribute("aria-hidden", "true"); }
    document.body.style.overflow = "hidden";
    surface.current?.focus();
    revealControls();
    let active = true;
    void session.then((exit) => { if (active && !exit) onClose(); });
    const onFullscreenChange = () => { if (!document.fullscreenElement) onClose(); };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      active = false;
      activeSession.current = null;
      clearTimeout(hideTimer.current);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (app) {
        app.inert = wasInert;
        if (ariaHidden === null) app.removeAttribute("aria-hidden"); else app.setAttribute("aria-hidden", ariaHidden);
      }
      document.body.style.overflow = overflow;
      // React StrictMode reattaches the same session before this microtask runs.
      void Promise.resolve().then(() => {
        if (activeSession.current !== session) return session.then(async (exit) => {
          await exit?.();
          if (!activeSession.current) onRestoreFocus();
        });
      })
        .catch(() => onError("Could not restore the window. Use your system's fullscreen control to exit fullscreen."));
    };
  }, [session, onClose, onError, onRestoreFocus, revealControls]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Keep app shortcuts and background viewers out of the presentation.
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key === "Tab") {
        revealControls();
        const buttons = Array.from(surface.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
        const position = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[position < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (position + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if ((event.key === " " || event.key === "Enter") && event.target instanceof HTMLButtonElement) {
        event.preventDefault(); event.target.click(); return;
      }
      if (["ArrowLeft", "PageUp", "ArrowRight", "PageDown", "Home", "End", " "].includes(event.key)) {
        event.preventDefault();
        if (event.key === "Home") onNavigate(0);
        else if (event.key === "End") onNavigate(count - 1);
        else onNavigate(Math.max(0, Math.min(count - 1, current + (["ArrowLeft", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey) ? -1 : 1))));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, count, onNavigate, onClose, revealControls]);
  return createPortal(<div ref={surface} className={`marp-presentation${controlsVisible ? " controls-visible" : ""}`} role="dialog" aria-modal="true" aria-label="Presentation" tabIndex={-1} onPointerMove={revealControls} onPointerDown={revealControls}>
    {children}
    <div className="marp-presentation-controls" aria-label="Presentation controls">
      <button aria-label="Previous slide" disabled={current === 0} onClick={() => onNavigate(current - 1)}><ChevronLeft size={20}/></button>
      <span aria-live="polite">{current + 1} / {count}</span>
      <button aria-label="Next slide" disabled={current === count - 1} onClick={() => onNavigate(current + 1)}><ChevronRight size={20}/></button>
      <span className="marp-presentation-separator"/>
      <button aria-label="Exit presentation" title="Exit presentation (Esc)" onClick={onClose}><X size={20}/></button>
    </div>
  </div>, document.body);
}

