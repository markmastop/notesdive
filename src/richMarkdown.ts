/** Keep YAML/TOML metadata byte-for-byte outside the editable document. */
export function splitMetadata(markdown: string) {
  const match = markdown.match(/^(---|\+\+\+)\n([\s\S]*?)\n\1(?:\n|$)/);
  const header = match?.[2] ?? "";
  const metadata =
    match &&
    (header.trim() === "" ||
      (match[1] === "---"
        ? /^[\w'".-]+\s*:/m.test(header)
        : /^[\w".-]+\s*=/m.test(header)));
  return metadata
    ? { prefix: match[0], body: markdown.slice(match[0].length) }
    : { prefix: "", body: markdown };
}

export function richUnsupportedReason(markdown: string): string | null {
  // Milkdown's GFM preset does not provide a footnote schema. Keep these notes
  // readable, with source editing available, rather than changing their meaning.
  const { body } = splitMetadata(markdown);
  if (/^ {0,3}\[\^[^\]]+\]:/m.test(body))
    return "This note contains footnotes. You can read it here and edit it in Markdown mode.";
  return null;
}
