import { useEffect, useRef, useState } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

import { clipboardImage, saveClipboardImage } from "./clipboardImages";

export function Editor({
  text,
  folder,
  notePath,
  disabled,
  onChange,
}: {
  text: string;
  folder: string;
  notePath: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const [pasteError, setPasteError] = useState("");
  const latest = useRef({ disabled, folder, notePath });
  latest.current = { disabled, folder, notePath };
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const editable = useRef(new Compartment());
  useEffect(() => {
    const instance = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorView.domEventHandlers({
            paste(event, editor) {
              const file = clipboardImage(event);
              if (!file || latest.current.disabled) return false;
              event.preventDefault();
              setPasteError("");
              const doc = editor.state.doc;
              const { from, to } = editor.state.selection.main;
              void saveClipboardImage(latest.current.folder, latest.current.notePath, file).then((src) => {
                if (view.current !== editor) return;
                if (latest.current.disabled || editor.state.doc !== doc) {
                  setPasteError("The note changed while pasting. Please paste the image again.");
                  return;
                }
                const insert = `![Image](${src})`;
                editor.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.paste" });
              }).catch((error) => { if (view.current === editor) setPasteError(String(error)); });
              return true;
            },
          }),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          placeholder("A little space for a new thought…"),
          keymap.of([
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          editable.current.of(EditorView.editable.of(!disabled)),
          EditorView.contentAttributes.of({
            "aria-label": "Markdown editor",
            spellcheck: "true",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !external.current)
              change.current(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "transparent" },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: "14px",
              lineHeight: "1.9",
            },
            ".cm-content": {
              padding: "42px 0 100px",
              maxWidth: "760px",
              margin: "0 auto",
              width: "100%",
              caretColor: "#277063",
            },
            ".cm-line": { padding: "0 48px" },
            "&.cm-focused": { outline: "none" },
            ".cm-activeLine": { backgroundColor: "#547c6705" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              backgroundColor: "#dceae1",
            },
            ".cm-cursor": { borderLeftColor: "#277063" },
            ".cm-panels": { backgroundColor: "#f0f2ec" },
          }),
        ],
      }),
    });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // Document identity is handled by the parent's key; text updates preserve selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const external = useRef(false);
  useEffect(() => {
    const instance = view.current;
    if (instance && instance.state.doc.toString() !== text) {
      external.current = true;
      instance.dispatch({
        changes: { from: 0, to: instance.state.doc.length, insert: text },
      });
      external.current = false;
    }
  }, [text]);
  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorView.editable.of(!disabled)),
    });
  }, [disabled]);
  return <><div className="editor-host" ref={host} />{pasteError && <p role="alert">{pasteError}</p>}</>;
}
