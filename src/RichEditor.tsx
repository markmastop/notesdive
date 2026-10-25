import { useEffect, useRef, useState } from "react";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import {
  commonmark,
  imageSchema,
  codeBlockSchema,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  toggleLinkCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  gfm,
  insertTableCommand,
  addRowAfterCommand,
  addColAfterCommand,
  toggleStrikethroughCommand,
} from "@milkdown/kit/preset/gfm";
import {
  history,
  undoCommand,
  redoCommand,
} from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { $prose, callCommand, replaceAll } from "@milkdown/kit/utils";
import {
  Plugin,
  TextSelection,
  NodeSelection,
} from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import type { EditorView, NodeView } from "@milkdown/kit/prose/view";
import type { Ctx } from "@milkdown/kit/ctx";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  SquareCode,
  Table2,
  Undo2,
  Redo2,
  Link,
  Plus,
  X,
} from "lucide-react";
import { splitMetadata, richUnsupportedReason } from "./richMarkdown";
import { renderMarkdown } from "./markdown";
import { openWebLink, webUrl } from "./webLinks";
import { clipboardImage, saveClipboardImage } from "./clipboardImages";
import { localImageData, showLocalImages } from "./localImages";

type Props = {
  text: string;
  folder: string;
  notePath: string;
  disabled: boolean;
  onChange: (text: string) => void;
  onSource: () => void;
};
type SelectionInfo = {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strike: boolean;
  heading: number;
  table: boolean;
};
const emptySelection: SelectionInfo = {
  bold: false,
  italic: false,
  code: false,
  strike: false,
  heading: 0,
  table: false,
};
function selectionInfo(view: EditorView): SelectionInfo {
  const { selection, storedMarks } = view.state;
  const marks = storedMarks ?? selection.$from.marks();
  const has = (name: string) => marks.some((m) => m.type.name === name);
  let heading = 0,
    table = false;
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    const node = selection.$from.node(depth);
    if (node.type.name === "heading") heading = node.attrs.level;
    if (node.type.name === "table") table = true;
  }
  return {
    bold: has("strong"),
    italic: has("emphasis"),
    code: has("inlineCode"),
    strike: has("strike_through"),
    heading,
    table,
  };
}

// Browser selectionchange events can lag behind rapid clicks/arrow keys. Read
// the visible caret before a new edit so undo's old selection cannot replace text.
function syncDomSelection(view: EditorView) {
  if (
    !view.hasFocus() ||
    view.composing ||
    view.state.selection instanceof NodeSelection
  )
    return;
  const selection = view.dom.ownerDocument.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !view.dom.contains(selection.anchorNode) ||
    !view.dom.contains(selection.focusNode)
  )
    return;
  try {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
    if (
      anchor === view.state.selection.anchor &&
      head === view.state.selection.head
    )
      return;
    const next = TextSelection.between(
      view.state.doc.resolve(anchor),
      view.state.doc.resolve(head),
    );
    view.dispatch(view.state.tr.setSelection(next));
  } catch {
    /* A DOM node removed by an external reload has no current position. */
  }
}

// Render images as inert placeholders without losing their Markdown destination.
function imageView(node: ProseNode, folder: string, notePath: string): NodeView {
  const dom = document.createElement("span");
  dom.className = "image-placeholder";
  dom.contentEditable = "false";
  dom.textContent = `[Image: ${node.attrs.alt || "image"}]`;
  dom.title = node.attrs.src;
  let active = true;
  void localImageData(folder, notePath, node.attrs.src || "").then((data) => {
    if (!active || !data) return;
    const image = document.createElement("img");
    image.src = data;
    image.alt = node.attrs.alt || "Image";
    dom.replaceChildren(image);
    dom.classList.add("loaded");
  });
  return { dom, destroy: () => { active = false; } };
}
function listItemView(
  node: ProseNode,
  view: EditorView,
  getPos: () => number | undefined,
): NodeView {
  let current = node;
  const dom = document.createElement("li");
  const contentDOM = document.createElement("div");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.contentEditable = "false";
  checkbox.setAttribute("aria-label", "Complete task");
  const update = (next: ProseNode) => {
    if (next.type !== current.type) return false;
    current = next;
    const task =
      next.attrs.checked !== null && next.attrs.checked !== undefined;
    dom.dataset.task = String(task);
    checkbox.hidden = !task;
    dom.dataset.label = next.attrs.label;
    dom.dataset.listType = next.attrs.listType;
    dom.dataset.spread = String(next.attrs.spread);
    checkbox.checked = Boolean(next.attrs.checked);
    return true;
  };
  checkbox.addEventListener("change", () => {
    const pos = getPos();
    if (view.editable && pos !== undefined)
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          checked: checkbox.checked,
        }),
      );
    else checkbox.checked = Boolean(current.attrs.checked);
  });
  dom.append(checkbox, contentDOM);
  update(node);
  return {
    dom,
    contentDOM,
    update,
    stopEvent: (event) => event.target === checkbox,
    ignoreMutation: (mutation) =>
      mutation.type !== "selection" &&
      (mutation.target === checkbox || mutation.target === dom),
  };
}

export function RichEditor({ text, folder, notePath, disabled, onChange, onSource }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<Editor | null>(null);
  const latest = useRef({ text, disabled, onChange });
  latest.current = { text, disabled, onChange };
  const lastText = useRef(text);
  const applying = useRef(false);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState("");
  const [selection, setSelection] = useState(emptySelection);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const fallbackRef = useRef<HTMLElement>(null);
  const unsupported = richUnsupportedReason(text);
  useEffect(() => {
    if ((unsupported || failure) && fallbackRef.current) return showLocalImages(fallbackRef.current, folder, notePath);
  }, [text, folder, notePath, unsupported, failure]);

  useEffect(() => {
    if (unsupported) return;
    let cancelled = false,
      mounted = false;
    const container = document.createElement("div");
    host.current!.append(container);
    const editor = Editor.make()
      .config((ctx) => {
        // Markdown images commonly have no title; upstream's string validator
        // rejects null titles. Normalize optional attributes before node creation.
        ctx.update(imageSchema.key, (original) => (schemaCtx) => {
          const schema = original(schemaCtx);
          return {
            ...schema,
            parseMarkdown: {
              ...schema.parseMarkdown,
              runner: (state, node, type) =>
                state.addNode(type, {
                  src: String(node.url ?? ""),
                  alt: String(node.alt ?? ""),
                  title: String(node.title ?? ""),
                }),
            },
          };
        });
        ctx.update(codeBlockSchema.key, (original) => (schemaCtx) => {
          const schema = original(schemaCtx);
          return {
            ...schema,
            attrs: {
              ...schema.attrs,
              meta: { default: "", validate: "string" },
            },
            parseMarkdown: {
              ...schema.parseMarkdown,
              runner: (state, node, type) => {
                state.openNode(type, {
                  language: node.lang ?? "",
                  meta: node.meta ?? "",
                });
                if (node.value) state.addText(String(node.value));
                state.closeNode();
              },
            },
            toMarkdown: {
              ...schema.toMarkdown,
              runner: (state, node) => {
                state.addNode("code", undefined, node.textContent, {
                  lang: node.attrs.language,
                  meta: node.attrs.meta || undefined,
                });
              },
            },
          };
        });
        ctx.set(rootCtx, container);
        ctx.set(defaultValueCtx, splitMetadata(latest.current.text).body);
        ctx.set(editorViewOptionsCtx, {
          editable: () => !latest.current.disabled && mounted && !cancelled,
          attributes: {
            role: "textbox",
            "aria-label": "Visual editor",
            "aria-multiline": "true",
            spellcheck: "true",
          },
          nodeViews: { image: (node) => imageView(node, folder, notePath), list_item: listItemView },
          handleDOMEvents: {
            keydown: (view) => {
              syncDomSelection(view);
              return false;
            },
            beforeinput: (view) => {
              syncDomSelection(view);
              return false;
            },
          },
          handlePaste: (view, event) => {
            const file = clipboardImage(event);
            if (!file || latest.current.disabled) return false;
            event.preventDefault();
            syncDomSelection(view);
            setPasteError("");
            const { doc, selection } = view.state;
            void saveClipboardImage(folder, notePath, file).then((src) => {
              if (cancelled) return;
              if (latest.current.disabled || view.state.doc !== doc) {
                setPasteError("The note changed while pasting. Please paste the image again.");
                return;
              }
              const image = view.state.schema.nodes.image.create({ src, alt: "Image", title: "" });
              view.dispatch(view.state.tr.setSelection(selection).replaceSelectionWith(image).scrollIntoView());
            }).catch((error) => { if (!cancelled) setPasteError(String(error)); });
            return true;
          },
          markViews: {
            link: (mark) => {
              const href = webUrl(mark.attrs.href);
              const dom = document.createElement(href ? "a" : "span");
              dom.className = "rich-link";
              dom.title = mark.attrs.href;
              if (href && dom instanceof HTMLAnchorElement) {
                dom.href = href;
                dom.dataset.webLink = "";
              }
              return { dom, contentDOM: dom };
            },
          },
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(
        $prose(
          (ctx) =>
            new Plugin({
              view: () => ({
                update: (view, previous) => {
                  if (!mounted || cancelled || applying.current) return;
                  setSelection(selectionInfo(view));
                  if (view.state.doc.eq(previous.doc)) return;
                  // Notify synchronously, before note switches and close/save actions.
                  // Initialization and external reloads never serialize back onto disk.
                  try {
                    const markdown =
                      splitMetadata(lastText.current).prefix +
                      ctx.get(serializerCtx)(view.state.doc);
                    lastText.current = markdown;
                    latest.current.onChange(markdown);
                  } catch (error) {
                    setFailure(
                      `The visual editor could not convert this change: ${String(error)}`,
                    );
                  }
                },
              }),
            }),
        ),
      );
    const creating = editor
      .create()
      .then(() => {
        if (cancelled) return;
        instance.current = editor;
        mounted = true;
        if (lastText.current !== latest.current.text) {
          applying.current = true;
          editor.action(
            replaceAll(splitMetadata(latest.current.text).body, true),
          );
          applying.current = false;
        }
        lastText.current = latest.current.text;
        editor.action((ctx) =>
          ctx
            .get(editorViewCtx)
            .setProps({ editable: () => !latest.current.disabled }),
        );
        setReady(true);
      })
      .catch((error) => {
        if (!cancelled)
          setFailure(
            `This note could not be opened in the visual editor. ${String(error)}`,
          );
      });
    return () => {
      cancelled = true;
      mounted = false;
      instance.current = null;
      container.remove();
      void creating.then(() => editor.destroy()).catch(() => {});
    };
    // Remounting is controlled by note identity and mode in the parent.
  }, [unsupported]);

  useEffect(() => {
    const editor = instance.current;
    if (!editor || lastText.current === text) return;
    applying.current = true;
    try {
      editor.action(replaceAll(splitMetadata(text).body, true));
      lastText.current = text;
      setSelection(
        editor.action((ctx) => selectionInfo(ctx.get(editorViewCtx))),
      );
    } catch (error) {
      setFailure(String(error));
    } finally {
      applying.current = false;
    }
  }, [text]);
  useEffect(() => {
    instance.current?.action((ctx) =>
      ctx
        .get(editorViewCtx)
        .setProps({ editable: () => !latest.current.disabled }),
    );
  }, [disabled]);

  function run(action: (ctx: Ctx) => unknown) {
    if (disabled || !ready || !instance.current) return;
    instance.current.action((ctx) => syncDomSelection(ctx.get(editorViewCtx)));
    instance.current.action(action);
    instance.current.action((ctx) => ctx.get(editorViewCtx).focus());
  }
  function changeList(type: "bullet_list" | "ordered_list") {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { $from, $to } = view.state.selection;
      // Convert the nearest list containing the selection, keeping its items
      // and nested lists intact. Wrapping commands only create new lists.
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name !== "bullet_list" && node.type.name !== "ordered_list")
          continue;
        if ($to.pos > $from.end(depth)) continue;
        if (node.type.name !== type) {
          const tr = view.state.tr.setNodeMarkup(
            $from.before(depth), view.state.schema.nodes[type],
            { spread: node.attrs.spread },
          );
          node.forEach((item, offset, index) => {
            tr.setNodeMarkup($from.start(depth) + offset, undefined, {
              ...item.attrs,
              listType: type === "bullet_list" ? "bullet" : "ordered",
              label: type === "bullet_list" ? "•" : `${index + 1}.`,
            });
          });
          view.dispatch(tr);
        }
        return;
      }
      callCommand(type === "bullet_list"
        ? wrapInBulletListCommand.key
        : wrapInOrderedListCommand.key)(ctx);
    });
  }
  function taskList() {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const inList = () => {
        const { $from } = view.state.selection;
        for (let depth = $from.depth; depth > 0; depth--)
          if ($from.node(depth).type.name === "list_item")
            return { node: $from.node(depth), pos: $from.before(depth) };
        return null;
      };
      if (!inList()) callCommand(wrapInBulletListCommand.key)(ctx);
      const item = inList();
      if (item)
        view.dispatch(
          view.state.tr.setNodeMarkup(item.pos, undefined, {
            ...item.node.attrs,
            checked: item.node.attrs.checked == null ? false : null,
          }),
        );
    });
  }
  function applyLink() {
    const href = url.trim();
    if (
      !href ||
      /^(?:javascript|data|vbscript):/i.test(href) ||
      /[\u0000-\u0020]/.test(href)
    ) {
      setLinkError("Enter a URL such as https://example.com.");
      return;
    }
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view.state.selection.empty) {
        const { from } = view.state.selection;
        const mark = view.state.schema.marks.link.create({ href });
        view.dispatch(
          view.state.tr
            .insertText(href)
            .addMark(from, from + href.length, mark),
        );
      } else callCommand(toggleLinkCommand.key, { href })(ctx);
    });
    setLinkOpen(false);
  }
  const toolbarDisabled = disabled || !ready || Boolean(failure);
  const button = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    active?: boolean,
  ) => (
    <button
      type="button"
      key={label}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`format-button ${active ? "active" : ""}`}
      disabled={toolbarDisabled}
      onMouseDown={(e) => {
        instance.current?.action((ctx) =>
          syncDomSelection(ctx.get(editorViewCtx)),
        );
        e.preventDefault();
      }}
      onClick={action}
    >
      {icon}
    </button>
  );
  if (unsupported || failure)
    return (
      <div className="rich-fallback">
        <div className="rich-notice" role="status">
          <span>{unsupported || failure}</span>
          <button onClick={onSource}>Edit Markdown</button>
        </div>
        <article
          ref={fallbackRef}
          className="markdown-preview"
          onClickCapture={(event) => openWebLink(event, setBrowserError)}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
        />
        {browserError && <p className="link-error" role="alert">{browserError}</p>}
      </div>
    );
  return (
    <div className="rich-editor" onClickCapture={(event) => openWebLink(event, setBrowserError)}>
      {pasteError && <p role="alert">{pasteError}</p>}
      {browserError && <p className="link-error" role="alert">{browserError}</p>}
      <div
        className="format-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <select
          aria-label="Text style"
          value={selection.heading}
          disabled={toolbarDisabled}
          onChange={(e) =>
            run(
              Number(e.target.value)
                ? callCommand(wrapInHeadingCommand.key, Number(e.target.value))
                : callCommand(turnIntoTextCommand.key),
            )
          }
        >
          <option value={0}>Paragraph</option>
          <option value={1}>Heading 1</option>
          <option value={2}>Heading 2</option>
          <option value={3}>Heading 3</option>
          <option value={4}>Heading 4</option>
          <option value={5}>Heading 5</option>
          <option value={6}>Heading 6</option>
        </select>
        <span className="format-divider" />
        {button(
          "Bold",
          <Bold size={16} />,
          () => run(callCommand(toggleStrongCommand.key)),
          selection.bold,
        )}
        {button(
          "Italic",
          <Italic size={16} />,
          () => run(callCommand(toggleEmphasisCommand.key)),
          selection.italic,
        )}
        {button(
          "Strikethrough",
          <Strikethrough size={16} />,
          () => run(callCommand(toggleStrikethroughCommand.key)),
          selection.strike,
        )}
        {button(
          "Inline code",
          <Code size={16} />,
          () => run(callCommand(toggleInlineCodeCommand.key)),
          selection.code,
        )}
        {button("Insert link", <Link size={16} />, () => {
          setUrl("");
          setLinkError("");
          setLinkOpen((v) => !v);
        })}
        <span className="format-divider" />
        {button("Bullet list", <List size={17} />, () =>
          changeList("bullet_list"),
        )}
        {button("Numbered list", <ListOrdered size={17} />, () =>
          changeList("ordered_list"),
        )}
        {button("Task list", <ListChecks size={17} />, taskList)}
        {button("Quote", <Quote size={16} />, () =>
          run(callCommand(wrapInBlockquoteCommand.key)),
        )}
        {button("Code block", <SquareCode size={16} />, () =>
          run(callCommand(createCodeBlockCommand.key)),
        )}
        {button("Insert table", <Table2 size={16} />, () =>
          run(callCommand(insertTableCommand.key, { row: 3, col: 3 })),
        )}
        <span className="format-divider" />
        {button("Undo", <Undo2 size={16} />, () =>
          run(callCommand(undoCommand.key)),
        )}
        {button("Redo", <Redo2 size={16} />, () =>
          run(callCommand(redoCommand.key)),
        )}
        {selection.table && (
          <>
            {button(
              "Add table row",
              <>
                <Plus size={12} />
                Row
              </>,
              () => run(callCommand(addRowAfterCommand.key)),
            )}
            {button(
              "Add table column",
              <>
                <Plus size={12} />
                Column
              </>,
              () => run(callCommand(addColAfterCommand.key)),
            )}
          </>
        )}
      </div>
      {linkOpen && (
        <form
          className="link-form"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <label htmlFor="link-url">Link</label>
          <input
            id="link-url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
          <button type="submit">Apply</button>
          <button
            type="button"
            aria-label="Cancel link"
            onClick={() => setLinkOpen(false)}
          >
            <X size={15} />
          </button>
          {linkError && <span role="alert">{linkError}</span>}
        </form>
      )}
      {!ready && <div className="rich-loading">Opening your note…</div>}
      <div className="rich-scroll" ref={host} />
    </div>
  );
}
