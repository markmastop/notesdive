import type { MarpDeck } from "./marp";

type SlideSource = MarpDeck["sources"][number];
export type SlideChange = { text: string; index: number };

export function insertMarpSlide(text: string, sources: SlideSource[], index: number, side: "before" | "after"): SlideChange {
  const source = sources[index];
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const title = `# New slide${newline}${newline}`;
  const separator = `---${newline}${newline}`;
  const at = side === "before" ? source.from : source.to;
  const insert = side === "before" ? title + separator : newline + newline + separator + title;
  return { text: text.slice(0, at) + insert + text.slice(at), index: index + (side === "after" ? 1 : 0) };
}

export function removeMarpSlide(text: string, sources: SlideSource[], index: number): SlideChange {
  const source = sources[index];
  // Keep YAML settings. Remove one adjacent separator with the slide so no
  // extra empty slide remains, including at the start or end of the deck.
  const from = index === 0 ? source.from : sources[index - 1].to;
  const to = index === 0 && sources.length > 1 ? sources[1].from : source.to;
  return { text: text.slice(0, from) + text.slice(to), index: Math.min(index, Math.max(0, sources.length - 2)) };
}

export function moveMarpSlide(text: string, sources: SlideSource[], index: number, direction: "earlier" | "later"): SlideChange {
  const destination = index + (direction === "earlier" ? -1 : 1);
  if (destination < 0 || destination >= sources.length) return { text, index };
  const left = sources[Math.min(index, destination)];
  const right = sources[Math.max(index, destination)];
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const rightBody = text.slice(right.from, right.to);
  // A final slide need not end with a newline. Once moved before a separator,
  // it needs a blank line so a paragraph cannot become a Setext heading.
  const boundary = /\n[ \t]*\n$/.test(rightBody.replace(/\r\n?/g, "\n")) ? "" : newline + newline;
  return {
    text: text.slice(0, left.from) + rightBody + boundary + text.slice(left.to, right.from) + text.slice(left.from, left.to) + text.slice(right.to),
    index: destination,
  };
}
