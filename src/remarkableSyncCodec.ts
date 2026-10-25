import MarkdownIt from "markdown-it";
import { parse } from "remarkable-rm";

// v6 typed text operations. All non-text blocks are retained byte for byte.
// The format is described by rmscene; no Python runtime is used by the app.
const HEADER = new TextEncoder().encode("reMarkable .lines file, version=6          ");
const TEMPLATE = "cmVNYXJrYWJsZSAubGluZXMgZmlsZSwgdmVyc2lvbj02ICAgICAgICAgIDEAAAAAAQEJAgwTAAAAELcZ0pj7rqJJh7qnF/5FmgsBAAwTAAAAENsJ3wN5akBNp5XXpga1yCECAAcAAAAAAQEAHwEBIQExABkAAAAAAAEKFAEAAAAkAAAAADQBAAAARAEAAABUAAAAABAAAAAAAQEBHwALLwAAMQFMAwAAAB8AAUQAAAAAAQEHHwAALCIAAAAcBgAAABwBAAAAACwSAAAAHA0AAAABAAAfARAsAgAAABEBPBAAAAAAAAAAAEB9wAAAAAAAQG1ARAAAakQcAAAAAAECAh8AASwKAAAAHwAALAIAAAAAATwFAAAAHwAAIQEjAAAAAAECAh8ACywRAAAAHwAMLAkAAAAHAUxheWVyIDE8BQAAAB8AACEBGgAAAAABAQQfAAEvAA0/AABPAABUAAAAAGwEAAAAAi8ACw==";
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const toBase64 = (data: Uint8Array) => { let out = ""; for (let i = 0; i < data.length; i += 8192) out += String.fromCharCode(...data.subarray(i, i + 8192)); return btoa(out); };
type Id = [number, number];
type Item = { id: Id; left: Id; right: Id; deleted: number; value: string | number };
type Style = { id: Id; time: Id; style: number };
const END: Id = [0, 0];
const key = (id: Id) => id.join(":");
const concat = (...parts: Uint8Array[]) => { const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { b.set(p, i); i += p.length; } return b; };
const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const variable = (n: number) => { const b = []; do { b.push((n % 128) | (n >= 128 ? 128 : 0)); n = Math.floor(n / 128); } while (n); return Uint8Array.from(b); };
const idBytes = (id: Id) => concat(Uint8Array.of(id[0]), variable(id[1]));
const taggedId = (n: number, id: Id) => concat(variable(n * 16 + 15), idBytes(id));
const integer = (n: number, v: number) => concat(variable(n * 16 + 4), u32(v));
const sub = (n: number, b: Uint8Array) => concat(variable(n * 16 + 12), u32(b.length), b);
class Reader {
  i = 0;
  constructor(readonly b: Uint8Array) {}
  bytes(n: number) { if (n < 0 || this.i + n > this.b.length) throw Error("Incomplete reMarkable text data"); const v = this.b.slice(this.i, this.i + n); this.i += n; return v; }
  byte() { return this.bytes(1)[0]; }
  uint() { return new DataView(this.bytes(4).buffer).getUint32(0, true); }
  variable() { let n = 0, f = 1; for (let j = 0; j < 8; j++) { const c = this.byte(); n += (c & 127) * f; if (!Number.isSafeInteger(n)) throw Error("Unsupported text ID"); if (!(c & 128)) return n; f *= 128; } throw Error("Invalid text ID"); }
  tag(n: number, kind: number) { if (this.variable() !== n * 16 + kind) throw Error("Unsupported reMarkable text layout"); }
  id(): Id { return [this.byte(), this.variable()]; }
  taggedId(n: number) { this.tag(n, 15); return this.id(); }
  sub(n: number) { this.tag(n, 12); return new Reader(this.bytes(this.uint())); }
  integer(n: number) { this.tag(n, 4); return this.uint(); }
  end() { if (this.i !== this.b.length) throw Error("Unknown text fields; notebook left unchanged"); }
}
function blocks(data: Uint8Array) {
  const r = new Reader(data); if (keyBytes(r.bytes(HEADER.length)) !== keyBytes(HEADER)) throw Error("Only v6 notebooks can be synced");
  const out: { type: number; head: Uint8Array; body: Uint8Array }[] = [];
  while (r.i < data.length) { const len = r.uint(), head = r.bytes(4), body = r.bytes(len); out.push({ type: head[3], head, body }); }
  return out;
}
const keyBytes = (b: Uint8Array) => Array.from(b).join(",");
function root(data: Uint8Array) {
  const all = blocks(data), texts = all.filter(b => b.type === 7);
  if (texts.length !== 1) throw Error("Sync requires one typed text block");
  const r = new Reader(texts[0].body); if (key(r.taggedId(1)) !== key(END)) throw Error("Unsupported typed text root");
  const content = r.sub(2), sequence = content.sub(1), entries = sequence.sub(1), count = entries.variable(), items: Item[] = [];
  if (count > 100000) throw Error("Notebook text is too large to sync");
  for (let j = 0; j < count; j++) {
    const item = entries.sub(0), id = item.taggedId(2), left = item.taggedId(3), right = item.taggedId(4), deleted = item.integer(5);
    let value: string | number = "";
    if (item.i < item.b.length) { const text = item.sub(6), n = text.variable(); if (text.byte() !== 1) throw Error("Unknown text encoding"); value = new TextDecoder("utf-8", { fatal: true }).decode(text.bytes(n)); if (text.i < text.b.length) { if (value) throw Error("Combined text and formatting is unsupported"); value = text.integer(2); } text.end(); }
    item.end(); items.push({ id, left, right, deleted, value });
  }
  entries.end(); sequence.end();
  const formats = content.sub(2), styleEntries = formats.sub(1), styles: Style[] = [], styleCount = styleEntries.variable();
  if (styleCount > 100000) throw Error("Too many paragraph styles");
  for (let j = 0; j < styleCount; j++) { const id = styleEntries.id(), time = styleEntries.taggedId(1), v = styleEntries.sub(2); if (v.byte() !== 17) throw Error("Unknown paragraph style"); const style = v.byte(); v.end(); styles.push({ id, time, style }); }
  styleEntries.end(); formats.end(); content.end();
  // Keep coordinates, width and any later fields exactly as stored.
  const tail = r.bytes(r.b.length - r.i);
  return { all, items, styles, tail };
}
function expand(items: Item[]) {
  const out = new Map<string, Item>();
  for (const item of items) {
    if (typeof item.value === "number") { out.set(key(item.id), item); continue; }
    const chars = item.deleted ? Array(item.deleted).fill("") as string[] : item.value.split("");
    if (chars.length > 100000) throw Error("Notebook text is too large");
    chars.forEach((value, i) => { const id: Id = [item.id[0], item.id[1] + i]; out.set(key(id), { id, left: i ? [id[0], id[1] - 1] : item.left, right: i < chars.length - 1 ? [id[0], id[1] + 1] : item.right, value, deleted: item.deleted ? 1 : 0 }); });
  }
  if (out.size > 100000) throw Error("Notebook text is too large");
  return out;
}
function sorted(items: Map<string, Item>) {
  const deps = new Map<string, Set<string>>(), next = new Map<string, Set<string>>();
  const edge = (a: string, b: string) => { const d = deps.get(b) ?? new Set<string>(); d.add(a); deps.set(b, d); const n = next.get(a) ?? new Set<string>(); n.add(b); next.set(a, n); if (!deps.has(a)) deps.set(a, new Set()); };
  for (const [k, item] of items) { const l = key(item.left), r = key(item.right); edge(items.has(l) ? l : "start", k); edge(k, items.has(r) ? r : "end"); }
  const result: Item[] = [];
  let ready = [...deps].filter(([, d]) => !d.size).map(([k]) => k), processed = 0;
  while (ready.length) { const batch = ready; ready = []; batch.filter(k => items.has(k)).sort((a, b) => { const x = items.get(a)!.id, y = items.get(b)!.id; return x[0] - y[0] || x[1] - y[1]; }).forEach(k => result.push(items.get(k)!)); for (const k of batch) { processed++; for (const n of next.get(k) ?? []) { deps.get(n)!.delete(k); if (!deps.get(n)!.size) ready.push(n); } } }
  if (processed !== deps.size) throw Error("Cyclic text operations; notebook left unchanged");
  return result;
}
const md = new MarkdownIt("commonmark");
function markdown(text: string) {
  if (text.length > 20000) throw Error("Sync currently supports notes up to 20,000 characters");
  const allowed = new Set(["heading_open", "heading_close", "paragraph_open", "paragraph_close", "inline", "bullet_list_open", "bullet_list_close", "list_item_open", "list_item_close"]);
  for (const t of md.parse(text, {})) if (!allowed.has(t.type) || (t.type === "heading_open" && !t.markup.startsWith("#"))) throw Error(`Unsupported Markdown: ${t.type}. This file was skipped.`);
  const values: (string | number)[] = [], styles: { position: number; style: number }[] = [];
  let position = 0;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    let body = line, style = 1;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line), bullet = /^( {0,2})[-*+]\s+(.*)$/.exec(line);
    if (heading) { if (heading[1].length > 2) throw Error("Only heading levels 1 and 2 can be synced"); style = heading[1].length === 1 ? 2 : 3; body = heading[2].replace(/\s+#+\s*$/, ""); }
    else if (bullet) { body = bullet[2]; const check = /^\[([ xX])\]\s+(.*)$/.exec(body); if (check) { if (bullet[1]) throw Error("Nested checkboxes cannot be synced"); style = check[1] === " " ? 6 : 7; body = check[2]; } else style = bullet[1] ? 5 : 4; }
    styles.push({ position: position ? position - 1 : -1, style });
    let boldDepth = 0, italicDepth = 0;
    for (const token of md.parseInline(body, {})[0].children ?? []) {
      if (token.type === "text") { const chars = token.content.split(""); values.push(...chars); position += chars.length; }
      else { if (token.type.startsWith("strong_")) boldDepth += token.type === "strong_open" ? 1 : -1;
        if (token.type.startsWith("em_")) italicDepth += token.type === "em_open" ? 1 : -1;
        const code = token.type.startsWith("strong_") ? (boldDepth ? 1 : 2) : token.type.startsWith("em_") ? (italicDepth ? 3 : 4) : undefined; if (!code) throw Error(`Unsupported Markdown: ${token.type}. This file was skipped.`); values.push(code); }
    }
    values.push("\n"); position++;
  }
  values.pop();
  return { values, styles, plain: values.filter(v => typeof v === "string").join("") };
}
export function decodeNotebook(data: Uint8Array): string {
  // Validate the source before using the display parser (which tolerates unknown fields).
  root(data);
  const doc = parse(data), text = doc.pages[0]?.rootText;
  if (!text || doc.pages.length !== 1) throw Error("Sync requires a single page of typed text");
  const prefixes: Record<string, string> = { plain: "", heading: "# ", bold: "## ", bullet: "- ", bullet2: "  - ", checkbox: "- [ ] ", "checkbox-checked": "- [x] " };
  return text.paragraphs.map(p => {
    if (!(p.style in prefixes) || p.spans.some(s => s.strikethrough)) throw Error("This notebook has unsupported text styles");
    let body = "", active: string[] = [];
    for (const s of p.spans) { const marks = [...(s.bold ? ["**"] : []), ...(s.italic ? ["*"] : [])]; if (marks.join() !== active.join()) { body += [...active].reverse().join("") + marks.join(""); active = marks; } body += s.text.replace(/([\\*_`\[\]])/g, "\\$1"); }
    body += active.reverse().join("");
    if (p.style === "plain" && /^(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/.test(body)) body = "\\" + body;
    return prefixes[p.style] + body;
  }).join("\n");
}
export function encodeNotebook(text: string, existing?: Uint8Array, writerId: string = crypto.randomUUID()): Uint8Array {
  const desired = markdown(text), parsed = root(existing ?? fromBase64(TEMPLATE));
  const expanded = expand(parsed.items), old = sorted(expanded).filter(i => !i.deleted && typeof i.value === "string" && i.value);
  const chars = desired.plain.split("");
  let prefix = 0, suffix = 0;
  while (prefix < old.length && prefix < chars.length && old[prefix].value === chars[prefix]) prefix++;
  while (suffix < old.length - prefix && suffix < chars.length - prefix && old[old.length - 1 - suffix].value === chars[chars.length - 1 - suffix]) suffix++;
  // Qt/native text IDs count UTF-16 units. Never split a surrogate pair at an edit boundary.
  if (prefix && /[\uD800-\uDBFF]/.test(chars[prefix - 1])) prefix--;
  if (suffix && /[\uDC00-\uDFFF]/.test(chars[chars.length - suffix])) suffix--;
  // New operations use a new author, without replacing any existing author UUIDs.
  const authorBlock = parsed.all.find(b => b.type === 9); if (!authorBlock) throw Error("Missing notebook author identities");
  const a = new Reader(authorBlock.body), authorCount = a.variable(), authors: Uint8Array[] = [], ids: number[] = [];
  for (let i = 0; i < authorCount; i++) { const s = a.sub(0); const n = s.variable(); if (n !== 16) throw Error("Unknown author identity"); const uuid = s.bytes(n), id = s.bytes(2); ids.push(new DataView(id.buffer).getUint16(0, true)); s.end(); authors.push(sub(0, concat(variable(16), uuid, id))); } a.end();
  const uuid = Uint8Array.from(writerId.replace(/-/g, "").match(/../g)!, x => parseInt(x, 16));
  if (uuid.length !== 16) throw Error("Invalid sync writer identity");
  uuid.set([...uuid.slice(0, 4)].reverse(), 0); uuid.set([...uuid.slice(4, 6)].reverse(), 4); uuid.set([...uuid.slice(6, 8)].reverse(), 6);
  // Each mapped notebook reuses its writer, so repeated syncs do not exhaust IDs.
  const existingAuthor = authors.findIndex(bytes => {
    const r = new Reader(bytes).sub(0); r.variable(); return keyBytes(r.bytes(16)) === keyBytes(uuid);
  });
  const author = existingAuthor >= 0 ? ids[existingAuthor] : Array.from({ length: 254 }, (_, i) => i + 1).find(id => !ids.includes(id));
  if (!author) throw Error("Too many notebook authors");
  if (existingAuthor < 0) authorBlock.body = concat(variable(authorCount + 1), ...authors, sub(0, concat(variable(16), uuid, Uint8Array.of(author, 0))));
  let clock = Math.max(16, ...Array.from(expanded.values(), i => i.id[1]), ...parsed.styles.map(s => s.time[1])) + 1;
  const left = prefix ? old[prefix - 1].id : END, right = suffix ? old[old.length - suffix].id : END;
  // Existing IDs become tombstones; outside the edited range character IDs survive.
  const removed = new Set(old.slice(prefix, old.length - suffix).map(i => key(i.id)));
  for (const item of expanded.values()) if (typeof item.value === "number" || removed.has(key(item.id))) { item.value = ""; item.deleted = 1; }
  const inserted = chars.slice(prefix, chars.length - suffix), insertedIds: Id[] = [];
  // Compressed insertion run, as written by the native editor.
  if (inserted.length) { const id: Id = [author, clock]; inserted.forEach((_, i) => insertedIds.push([author, clock + i])); clock += inserted.length; expanded.set(key(id), { id, left, right, deleted: 0, value: inserted.join("") }); }
  const newIds = [...old.slice(0, prefix).map(i => i.id), ...insertedIds, ...old.slice(old.length - suffix).map(i => i.id)];
  let at = 0, previous: Id | null = null;
  for (const v of desired.values) if (typeof v === "string") { at++; previous = null; } else { const id: Id = [author, clock++]; expanded.set(key(id), { id, left: previous ?? newIds[at - 1] ?? END, right: newIds[at] ?? END, deleted: 0, value: v }); previous = id; }
  const styles = new Map(parsed.styles.map(s => [key(s.id), s]));
  for (const s of desired.styles) { const id = s.position < 0 ? END : newIds[s.position]; styles.set(key(id), { id, time: [author, clock++], style: s.style }); }
  const consumed = new Set<string>();
  const serialItems: Item[] = [];
  for (const i of expanded.values()) {
    if (consumed.has(key(i.id))) continue;
    if (typeof i.value === "string" && /^[\uD800-\uDBFF]$/.test(i.value)) {
      const second = expanded.get(key([i.id[0], i.id[1] + 1]));
      if (!second || typeof second.value !== "string" || !/^[\uDC00-\uDFFF]$/.test(second.value) || key(i.right) !== key(second.id)) throw Error("Unsupported Unicode text operation; notebook left unchanged");
      serialItems.push({ ...i, value: i.value + second.value, right: second.right }); consumed.add(key(second.id));
    } else {
      if (typeof i.value === "string" && /^[\uDC00-\uDFFF]$/.test(i.value)) continue;
      serialItems.push(i);
    }
  }
  const items = serialItems.map(i => { let value = new Uint8Array(); if (typeof i.value === "number") value = sub(6, concat(variable(0), Uint8Array.of(1), integer(2, i.value))); else if (i.value) { const b = new TextEncoder().encode(i.value); value = sub(6, concat(variable(b.length), Uint8Array.of(1), b)); } return sub(0, concat(taggedId(2, i.id), taggedId(3, i.left), taggedId(4, i.right), integer(5, i.deleted), value)); });
  const formatBytes = [...styles.values()].map(s => concat(idBytes(s.id), taggedId(1, s.time), sub(2, Uint8Array.of(17, s.style))));
  parsed.all.find(b => b.type === 7)!.body = concat(taggedId(1, END), sub(2, concat(sub(1, sub(1, concat(variable(items.length), ...items))), sub(2, sub(1, concat(variable(styles.size), ...formatBytes))))), parsed.tail);
  const info = parsed.all.find(b => b.type === 10);
  if (info) {
    const r = new Reader(info.body), loads = r.integer(1), merges = r.integer(2); r.integer(3); r.integer(4);
    info.body = concat(integer(1, loads), integer(2, merges + (existing ? 1 : 0)), integer(3, chars.length + 1), integer(4, desired.plain.split("\n").length), r.bytes(r.b.length - r.i));
  }
  const result = concat(HEADER, ...parsed.all.map(b => concat(u32(b.body.length), b.head, b.body)));
  // Validate read-back before authorising any cloud writes.
  const decoded = markdown(decodeNotebook(result));
  const semantic = (values: (string | number)[]) => {
    let bold = false, italic = false;
    return values.flatMap(value => {
      if (typeof value === "number") { if (value <= 2) bold = value === 1; else italic = value === 3; return []; }
      return [[value, bold, italic]];
    });
  };
  if (JSON.stringify(semantic(decoded.values)) !== JSON.stringify(semantic(desired.values)) || JSON.stringify(decoded.styles) !== JSON.stringify(desired.styles)) throw Error("Native text verification failed; notebook left unchanged");
  return result;
}
export function canonicalMarkdown(text: string) { return decodeNotebook(encodeNotebook(text)); }
