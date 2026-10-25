import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Grid2X2, NotebookPen, PanelTop, Presentation, RefreshCw, Plus, Trash2, Undo2, ArrowUp, ArrowDown, X } from "lucide-react";
import { insertMarpSlide, removeMarpSlide, moveMarpSlide, type SlideChange } from "./marpSlideEdits";
import { Editor } from "./Editor";
import { renderMarp, type MarpDeck } from "./marp";
import { localMarpBackground } from "./marpStyles";
import { renderMarkdown } from "./markdown";
import { openWebLink } from "./webLinks";
import { localImageData, showLocalImages } from "./localImages";
import { builtinMarpThemes, loadMarpTheme, type MarpTheme } from "./marpThemes";
import { enterPresentationFullscreen } from "./presentationFullscreen";

type PresentationSession = Promise<(() => Promise<void>) | null>;

function Slide({ slide, deck, label, folder, notePath, onLinkError }: {
  slide: MarpDeck["slides"][number]; deck: MarpDeck; label: string; folder: string; notePath: string; onLinkError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = host.current;
    if (!element || !surface.current) return;
    setRoot(surface.current.shadowRoot || surface.current.attachShadow({ mode: "open" }));
    const resize = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    let active = true;
    const read = (source: string) => localImageData(folder, notePath, source);
    for (const image of element.querySelectorAll<HTMLImageElement>("img[data-marp-image]")) {
      void read(image.dataset.marpImage || "").then((data) => {
        if (!active) return;
        if (data) image.src = data;
        else {
          const placeholder = document.createElement("span");
          placeholder.className = "image-placeholder";
          placeholder.textContent = `[Image: ${image.alt || "unavailable"}]`;
          image.replaceWith(placeholder);
        }
      });
    }
    for (const background of element.querySelectorAll<HTMLElement>("[data-marp-background]")) {
      void localMarpBackground(background.dataset.marpBackground || "", read).then((value) => {
        if (active) background.style.backgroundImage = value;
      });
    }
    return () => { active = false; };
  }, [root, slide.html, folder, notePath]);
  const scale = Math.min(size.width / deck.width, size.height / deck.height);
  return <div className="marp-slide-host" ref={host} aria-label={label}>
    <div ref={surface} className="marp-slide" style={{ width: deck.width, height: deck.height, transform: `scale(${scale})` }}>
      {root && createPortal(<>
        <style>{deck.css}</style>
        <style>{`div.marpit { width: 100%; height: 100%; } .image-placeholder { border: 1px dashed currentColor; padding: .25em .5em; font-size: .6em; opacity: .7; }`}</style>
        <div className="marpit" ref={content} onClickCapture={(event) => openWebLink(event, onLinkError)} dangerouslySetInnerHTML={{ __html: slide.html }} />
      </>, root)}
    </div>
  </div>;
}

function Slideshow({ session, deck, current, onNavigate, onClose, onError, onRestoreFocus, folder, notePath }: {
  session: PresentationSession; deck: MarpDeck; current: number; onNavigate: (index: number) => void;
  onClose: () => void; onError: (message: string) => void; onRestoreFocus: () => void; folder: string; notePath: string;
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
        else if (event.key === "End") onNavigate(deck.slides.length - 1);
        else onNavigate(Math.max(0, Math.min(deck.slides.length - 1, current + (["ArrowLeft", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey) ? -1 : 1))));
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [current, deck.slides.length, onNavigate, onClose, revealControls]);
  return createPortal(<div ref={surface} className={`marp-presentation${controlsVisible ? " controls-visible" : ""}`} role="dialog" aria-modal="true" aria-label="Presentation" tabIndex={-1} onPointerMove={revealControls} onPointerDown={revealControls}>
    <Slide slide={deck.slides[current]} deck={deck} label={`Slide ${current + 1}`} folder={folder} notePath={notePath} onLinkError={onError}/>
    <div className="marp-presentation-controls" aria-label="Presentation controls">
      <button aria-label="Previous slide" disabled={current === 0} onClick={() => onNavigate(current - 1)}><ChevronLeft size={20}/></button>
      <span aria-live="polite">{current + 1} / {deck.slides.length}</span>
      <button aria-label="Next slide" disabled={current === deck.slides.length - 1} onClick={() => onNavigate(current + 1)}><ChevronRight size={20}/></button>
      <span className="marp-presentation-separator"/>
      <button aria-label="Exit presentation" title="Exit presentation (Esc)" onClick={onClose}><X size={20}/></button>
    </div>
  </div>, document.body);
}

export function MarpViewer({ text, folder, notePath, library, index, onNavigate: setIndex, editing, onEdit, disabled, onChange }: {
  text: string; folder: string; notePath: string; library: string | null;
  index: number; onNavigate: (index: number) => void; editing: boolean; onEdit: () => void;
  disabled: boolean; onChange: (text: string) => void;
}) {
  const [theme, setTheme] = useState<(MarpTheme & { key: string; error: string }) | null>(null);
  const [themeReload, setThemeReload] = useState(0);
  // The first render discovers the requested theme, even if it isn't registered yet.
  const baseRendered = useMemo(() => {
    try { return { deck: renderMarp(text), error: "" }; }
    catch { return { deck: null, error: "Could not render this presentation. Check its directives and CSS in Edit Markdown." }; }
  }, [text]);
  const requested = baseRendered.deck?.theme || "default";
  const themeKey = JSON.stringify([folder, notePath, requested, library]);
  const customTheme = !builtinMarpThemes.has(requested);
  useEffect(() => {
    if (!customTheme) return;
    let active = true;
    setTheme(null);
    void loadMarpTheme(folder, notePath, requested, library).then(
      (loaded) => { if (active) setTheme({ ...loaded, key: themeKey, error: "" }); },
      (error: Error) => { if (active) setTheme({ key: themeKey, css: "", images: new Map(), warning: "", error: error.message }); },
    );
    return () => { active = false; };
  }, [folder, notePath, requested, customTheme, themeKey, themeReload, library]);
  const loadedTheme = theme?.key === themeKey ? theme : undefined;
  const rendered = useMemo(() => {
    if (!loadedTheme?.css) return baseRendered;
    try { return { deck: renderMarp(text, loadedTheme.css, loadedTheme.images), error: "" }; }
    catch { return { deck: null, error: "Could not render this presentation. Check its directives and CSS in Edit Markdown." }; }
  }, [text, loadedTheme, baseRendered]);
  const [slideRevision, setSlideRevision] = useState(0);
  const [undoSlide, setUndoSlide] = useState<{ before: string; after: string; index: number } | null>(null);
  const [grid, setGrid] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [presentation, setPresentation] = useState<PresentationSession | null>(null);
  const closePresentation = useCallback(() => setPresentation(null), []);
  const presentationButton = useRef<HTMLButtonElement>(null);
  const restorePresentationFocus = useCallback(() => presentationButton.current?.focus(), []);
  const notesContent = useRef<HTMLDivElement>(null);
  const deck = rendered.deck;
  const count = deck?.slides.length || 0;
  const current = Math.min(index, Math.max(0, count - 1));
  const notes = deck?.slides[current]?.notes || [];
  const notesHtml = useMemo(() => renderMarkdown(notes.join("\n\n")), [notes]);
  useEffect(() => { setUndoSlide(null); setGrid(false); setLinkError(""); setPresentation(null); }, [folder, notePath]);
  useEffect(() => {
    if (notesContent.current) return showLocalImages(notesContent.current, folder, notePath);
  }, [notesHtml, notesOpen, grid, folder, notePath]);
  useEffect(() => {
    if (presentation || grid || !count) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (["ArrowLeft", "PageUp", "ArrowRight", "PageDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "Home") setIndex(0);
        else if (event.key === "End") setIndex(count - 1);
        else setIndex(Math.max(0, Math.min(count - 1, current + (["ArrowLeft", "PageUp"].includes(event.key) ? -1 : 1))));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [presentation, grid, count, current, setIndex]);
  if (!deck || !count) return <div className="marp-viewer"><p className="asset-message" role="alert">{rendered.error || "This presentation has no slides."}</p>
    {customTheme && <button onClick={() => setThemeReload((value) => value + 1)}>Reload presentation theme</button>}</div>;
  const source = deck.sources[current];
  const editSlide = editing && !grid && source;
  const changeSlides = (change: SlideChange) => {
    setUndoSlide({ before: text, after: change.text, index: current });
    setSlideRevision((value) => value + 1);
    onChange(change.text);
    setIndex(change.index);
  };
  const hasNotes = deck.slides.some((slide) => slide.notes.length > 0);
  return <div className={`marp-viewer${editSlide ? " marp-editing" : ""}`} aria-label="Marp slide viewer">
    <div className="pdf-toolbar marp-toolbar">
      <button aria-label="Previous slide" disabled={grid || current === 0} onClick={() => setIndex(current - 1)}><ChevronLeft size={16}/></button>
      <span aria-live="polite">Slide {current + 1} of {count}</span>
      <button aria-label="Next slide" disabled={grid || current === count - 1} onClick={() => setIndex(current + 1)}><ChevronRight size={16}/></button>
      <select aria-label="Go to slide" value={current} onChange={(event) => { setIndex(Number(event.target.value)); setGrid(false); }}>
        {deck.slides.map((_, number) => <option key={number} value={number}>Slide {number + 1}</option>)}
      </select>
      <span className="pdf-toolbar-spacer"/>
      {!editing && <button className="marp-edit-button" onClick={onEdit} title="Edit this slide"><NotebookPen size={16}/><span>Edit slide</span></button>}
      {customTheme && <button aria-label="Reload presentation theme" title={`Reload ${requested} theme`} onClick={() => setThemeReload((value) => value + 1)}><RefreshCw size={16}/></button>}
      <button className="marp-notes-toggle" aria-label="Show speaker notes" aria-pressed={notesOpen} aria-controls="marp-speaker-notes" disabled={grid || !hasNotes} onClick={() => setNotesOpen(!notesOpen)} title="Speaker notes"><NotebookPen size={16}/><span>Notes</span></button>
      <button aria-label="Show slide grid" title="Slide grid" aria-pressed={grid} onClick={() => setGrid(true)}><Grid2X2 size={16}/></button>
      <button aria-label="Show single slide" title="View slide" aria-pressed={!grid} onClick={() => setGrid(false)}><PanelTop size={16}/></button>
      <button ref={presentationButton} aria-label="Start presentation" title="Present fullscreen" disabled={!!presentation || (customTheme && theme?.key !== themeKey)} onClick={() => {
        setLinkError("");
        setGrid(false);
        // Start directly in the click handler to retain browser user activation.
        setPresentation(enterPresentationFullscreen().catch(() => {
          setLinkError("Could not start fullscreen presentation. Please try again.");
          return null;
        }));
      }}><Presentation size={16}/></button>
    </div>
    {linkError && <p className="link-error" role="alert">{linkError}</p>}
    {customTheme && (theme?.key !== themeKey ? <p className="marp-theme-status" role="status">Loading {requested} theme…</p>
      : theme.error && <p className="marp-theme-status" role="status">{theme.error} Showing the default theme.</p>)}
    {loadedTheme?.warning && <p className="marp-theme-status" role="status">{loadedTheme.warning}</p>}
    {grid ? <div className="marp-grid">{deck.slides.map((slide, number) =>
      <button key={number} className="marp-tile" style={{ "--marp-aspect": `${deck.width} / ${deck.height}` } as React.CSSProperties} onClick={() => { setIndex(number); setGrid(false); }} aria-label={`Open slide ${number + 1}`}>
        <Slide slide={slide} deck={deck} label={`Slide ${number + 1} thumbnail`} folder={folder} notePath={notePath} onLinkError={setLinkError}/><span>{number + 1}{slide.notes.length > 0 && <NotebookPen size={12} aria-label="Has speaker notes"/>}</span>
      </button>)}</div>
    : <>
      <div className="marp-stage"><Slide slide={deck.slides[current]} deck={deck} label={`Slide ${current + 1}`} folder={folder} notePath={notePath} onLinkError={setLinkError}/></div>
      {editSlide && <section className="marp-slide-editor" aria-label={`Edit slide ${current + 1}`}>
        <div className="marp-editor-label">Markdown · Slide {current + 1}<span>Changes save automatically</span></div>
        <div className="marp-slide-actions" role="group" aria-label="Slide actions">
          <button disabled={disabled} onClick={() => changeSlides(insertMarpSlide(text, deck.sources, current, "before"))}><Plus size={14}/>Insert before</button>
          <button disabled={disabled} onClick={() => changeSlides(insertMarpSlide(text, deck.sources, current, "after"))}><Plus size={14}/>Insert after</button>
          <button disabled={disabled || current === 0} onClick={() => changeSlides(moveMarpSlide(text, deck.sources, current, "earlier"))}><ArrowUp size={14}/>Move earlier</button>
          <button disabled={disabled || current === count - 1} onClick={() => changeSlides(moveMarpSlide(text, deck.sources, current, "later"))}><ArrowDown size={14}/>Move later</button>
          <button disabled={disabled} title={count === 1 ? "Clear the last slide, keeping presentation settings" : "Remove this slide and its speaker notes"} onClick={() => changeSlides(removeMarpSlide(text, deck.sources, current))}><Trash2 size={14}/>{count === 1 ? "Clear slide" : "Delete slide"}</button>
          {undoSlide && <button disabled={disabled || text !== undoSlide.after} onClick={() => {
            onChange(undoSlide.before); setIndex(undoSlide.index); setSlideRevision((value) => value + 1); setUndoSlide(null);
          }}><Undo2 size={14}/>Undo slide change</button>}
        </div>
        <Editor key={`${folder}/${notePath}/${current}/${slideRevision}`} text={text.slice(source.from, source.to)} folder={folder} notePath={notePath} disabled={disabled}
          onChange={(value) => onChange(text.slice(0, source.from) + value + (source.to < text.length && value && !/[\r\n]$/.test(value) ? (text.includes("\r\n") ? "\r\n" : "\n") : "") + text.slice(source.to))}/>
      </section>}
      {notesOpen && <aside id="marp-speaker-notes" className="marp-notes" aria-label="Speaker notes">
        <h3>Speaker notes <span>Slide {current + 1}</span></h3>
        {notes.length ? <div ref={notesContent} className="markdown-preview" onClickCapture={(event) => openWebLink(event, setLinkError)} dangerouslySetInnerHTML={{ __html: notesHtml }}/>
          : <p className="marp-notes-empty">No speaker notes for this slide.</p>}
      </aside>}
    </>}
    {presentation && <Slideshow session={presentation} deck={deck} current={current} onNavigate={setIndex} onClose={closePresentation} onError={setLinkError} onRestoreFocus={restorePresentationFocus} folder={folder} notePath={notePath}/>}
  </div>;
}
