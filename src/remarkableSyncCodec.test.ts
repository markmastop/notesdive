import { describe, it, expect } from "vitest";
import { canonicalMarkdown, encodeNotebook, decodeNotebook } from "./remarkableSyncCodec";
import { planSync, type SyncNote } from "./remarkableFolderSync";
import { toBase64 } from "./remarkableSyncCodec";
const original = "# Title\n\nHello **bold** and *italic*.\n\n## Tasks\n\n- One\n- [ ] Open\n- [x] Done\n";
describe("native notebook folder sync", () => {
  it("round trips headings, marks, lists and checkboxes", () => { expect(canonicalMarkdown(original)).toBe(original); });
  it("updates the existing CRDT without duplicating text", () => {
    let data = encodeNotebook(original);
    for (const text of [original.replace("Hello", "Hallo"), original.replace("[ ] Open", "[x] Open"), "# New\n\nNew text\n", original, ""]) {
      data = encodeNotebook(text, data);
      expect(decodeNotebook(data)).toBe(canonicalMarkdown(text));
    }
  });
  it("rejects unsupported syntax without flattening it", () => { for (const text of ["### Heading", "[link](https://example.com)", "```\ncode\n```", "> quote", "1. Numbered"]) expect(() => encodeNotebook(text)).toThrow(); });
  const note = (local: string, remote: string, localChanged: boolean, remoteChanged: boolean): SyncNote => ({ mapping: { path: "test.md", documentId: "be11a099-7c68-4216-94c8-1cc01591717a", pageId: "page", localHash: "base-local", remoteHash: "base-remote" }, local: { content: local, revision: localChanged ? "new-local" : "base-local" }, remoteData: toBase64(encodeNotebook(remote)), remoteHash: remoteChanged ? "new-remote" : "base-remote" });
  it("keeps both versions when both changed", () => { expect(planSync(note("Local", "Remote", true, true)).action).toBe("conflict"); });
  it("pulls remote-only edits and uploads local-only edits", () => { expect(planSync(note("Base", "Remote", false, true)).action).toBe("download"); expect(planSync(note("Local", "Base", true, false)).action).toBe("upload"); });
  it("recovers an interrupted upload and ignores CRDT-only changes", () => { expect(planSync(note(original, original, true, true)).action).toBe("unchanged"); });
  it("never mirrors a local deletion", () => { const n = note("Local", "Remote", true, false); n.local = null; expect(planSync(n)).toMatchObject({ action: "skip", content: "Local file removed; deletions are not mirrored." }); });
  it("does not recreate a removed remote notebook", () => { const n = note("Local", "Remote", true, true); n.error = "Notebook removed"; n.remoteData = null; expect(planSync(n).action).toBe("skip"); });
});

function nativeBlocks(data: Uint8Array) {
  const out: { type: number; bytes: Uint8Array }[] = [];
  let i = new TextEncoder().encode("reMarkable .lines file, version=6          ").length;
  while (i < data.length) { const size = new DataView(data.buffer, data.byteOffset + i, 4).getUint32(0, true); out.push({ type: data[i + 7], bytes: data.slice(i, i + 8 + size) }); i += 8 + size; }
  return out;
}
it("keeps scene and unknown blocks byte-for-byte", () => {
  const source = encodeNotebook("# Original\n\nText\n");
  const unknown = Uint8Array.of(3, 0, 0, 0, 0, 1, 1, 250, 11, 22, 33);
  const withUnknown = new Uint8Array(source.length + unknown.length); withUnknown.set(source); withUnknown.set(unknown, source.length);
  const updated = encodeNotebook("# Changed\n\nText\n", withUnknown);
  const scene = (bytes: Uint8Array) => nativeBlocks(bytes).filter(b => ![7, 9, 10].includes(b.type));
  expect(scene(updated)).toEqual(scene(withUnknown));
});
it("reuses the mapped author for repeated edits and supports Unicode", () => {
  const writer = "bb37e240-3509-4a53-a114-221116de2893";
  let data = encodeNotebook("Café 🚗\n", undefined, writer);
  const authorCount = (bytes: Uint8Array) => nativeBlocks(bytes).find(b => b.type === 9)!.bytes[8];
  const count = authorCount(data);
  for (let i = 0; i < 20; i++) { const text = `# Café 🚗 ${i}\n\n- [${i % 2 ? "x" : " "}] Controleren\n`; data = encodeNotebook(text, data, writer); expect(decodeNotebook(data)).toBe(text); }
  expect(authorCount(data)).toBe(count);
});

it("keeps nested bold active after the inner mark closes", () => { expect(canonicalMarkdown("**outer __inner__ end**")).toBe("**outer inner end**"); });
