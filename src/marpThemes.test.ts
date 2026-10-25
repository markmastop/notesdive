import { expect, it } from "vitest";
import { loadMarpTheme, marpThemeImagePath, marpThemePaths } from "./marpThemes";
import { renderMarp } from "./marp";

it("finds local/shared themes without allowing paths or URLs as theme names", () => {
  expect(marpThemePaths("slides/Workshop.md", "workshop")).toEqual(["slides/themes/workshop.css", "themes/workshop.css"]);
  expect(marpThemePaths("Workshop.md", "workshop")).toEqual(["themes/workshop.css"]);
  expect(marpThemePaths("Workshop.md", "../outside")).toEqual([]);
  expect(marpThemePaths("Workshop.md", "https://example.com/theme")).toEqual([]);
});

it("falls back to the current library and preserves built-in theme inheritance", async () => {
  const css = '/* @theme workshop */\n@import "default";\nsection { background: #112233; color: white; }';
  const visited: string[] = [];
  const loaded = await loadMarpTheme("/notes", "slides/Workshop.md", "workshop", "/library", async (path) => { visited.push(path); throw Error("Missing"); }, async () => css);
  expect(visited).toEqual(["slides/themes/workshop.css", "themes/workshop.css"]);
  const deck = renderMarp('---\nmarp: true\ntheme: workshop\n---\n# Title', loaded.css, loaded.images);
  expect(deck.theme).toBe("workshop");
  expect(deck.css).toContain("#112233");
  expect(deck.css).toContain("font-size");
  expect(deck.css).not.toContain('@import "default"');
});

it("resolves images beside CSS without allowing URLs or escapes from the themes folder", () => {
  expect(marpThemeImagePath("slides/themes/demo.css", "demo/photo.png")).toBe("slides/themes/demo/photo.png");
  expect(marpThemeImagePath("themes/demo.css", "../secret.png")).toBeNull();
  expect(marpThemeImagePath("themes/demo.css", "https://example.com/photo.png")).toBeNull();
  expect(marpThemeImagePath("themes/demo.css", "data:image/svg+xml,aaa")).toBeNull();
  expect(marpThemeImagePath("themes/demo.css", "/outside.png")).toBeNull();
  expect(marpThemeImagePath("themes/demo.css", "demo/font.woff")).toBeNull();
});

it("loads only scoped local theme images and retains them after Marp sanitization", async () => {
  const css = '/* @theme demo */\n@import "default"; section { background-image: url("demo/photo.png"), url("https://example.com/track.png"); } section::before { content: ""; background-image: url("../secret.png"); }';
  const visited: string[] = [];
  const loaded = await loadMarpTheme("/notes", "Workshop.md", "demo", "/library", async () => { throw Error("Missing"); }, async () => css, async (root, path, shared) => {
    visited.push(`${root}:${path}:${shared}`);
    return { mime: "image/png", data: "AAAA" };
  });
  expect(visited).toEqual(["/library:themes/demo/photo.png:true"]);
  const deck = renderMarp('---\nmarp: true\ntheme: demo\n---\n# Title', loaded.css, loaded.images);
  expect(deck.css).toContain("data:image/png;base64,AAAA");
  expect(deck.css).not.toContain("https://example.com");
  expect(deck.css).not.toContain("secret.png");
  expect(renderMarp('---\nmarp: true\ntheme: demo\n---\n# Title', css).css).not.toContain("demo/photo.png");
});

it("keeps a theme usable and reports missing images", async () => {
  const css = '/* @theme demo */ section { background-image: url("demo/missing.png"); }';
  const loaded = await loadMarpTheme("/notes", "Workshop.md", "demo", null, async () => css, undefined, async () => { throw Error("Missing"); });
  expect(loaded.css).toBe(css);
  expect(loaded.images.size).toBe(0);
  expect(loaded.warning).toContain("theme images are unavailable");
});

it("retains embedded theme artwork through both CSS sanitization passes", async () => {
  const svg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"><path fill="orange" d="M0 0h100v100H0z"/></svg>')}`;
  const png = "data:image/png;base64,AAAA";
  const css = `/* @theme demo */ @import "default"; section.titel { background: url("${svg}") center / cover, url("${png}"), red; }`;
  const loaded = await loadMarpTheme("/notes", "Workshop.md", "demo", null, async () => css, undefined, async () => { throw Error("Embedded images must not read files"); });
  expect(loaded.warning).toBe("");
  expect(loaded.images.size).toBe(2);
  const deck = renderMarp('---\nmarp: true\ntheme: demo\n---\n<!-- _class: titel -->\n# Title', loaded.css, loaded.images);
  expect(deck.css).toContain(svg);
  expect(deck.css).toContain(png);
  expect(deck.slides[0].html).toContain('class="titel"');
});

it("rejects unsupported and malformed embedded theme resources", async () => {
  const sources = ["data:text/html;base64,AAAA", "data:image/svg+xml,<svg/>", "data:image/png;base64,%%%"];
  const css = `/* @theme demo */ section { background: ${sources.map((source) => `url("${source}")`).join(",")}; }`;
  const loaded = await loadMarpTheme("/notes", "Workshop.md", "demo", null, async () => css);
  expect(loaded.images.size).toBe(0);
  expect(loaded.warning).toContain("theme images are unavailable");
  const deck = renderMarp('---\nmarp: true\ntheme: demo\n---\n# Title', loaded.css, loaded.images);
  for (const source of sources) expect(deck.css).not.toContain(source);
});

it("bounds image count and resolves local images from the loaded CSS location", async () => {
  const css = `/* @theme demo */ section { background-image: ${Array.from({ length: 33 }, (_, i) => `url("demo/image-${i}.png")`).join(",")}; }`;
  const visited: string[] = [];
  const loaded = await loadMarpTheme("/notes", "slides/Workshop.md", "demo", null, async () => css, undefined, async (root, path, shared) => {
    visited.push(`${root}:${path}:${shared}`);
    return { mime: "image/png", data: "AAAA" };
  });
  expect(visited).toHaveLength(32);
  expect(visited[0]).toBe("/notes:slides/themes/demo/image-0.png:false");
  expect(loaded.images.size).toBe(32);
  expect(loaded.warning).toContain("theme images are unavailable");
});

it("reports mismatched or missing custom themes instead of silently ignoring their names", async () => {
  await expect(loadMarpTheme("/notes", "Workshop.md", "workshop", null, async () => '/* @theme other */')).rejects.toThrow('The CSS must declare /* @theme workshop */');
  await expect(loadMarpTheme("/notes", "Workshop.md", "workshop", null, async () => { throw "Theme file not found: themes/workshop.css"; })).rejects.toThrow('Theme "workshop" not found');
  await expect(loadMarpTheme("/notes", "Workshop.md", "workshop", null, async () => { throw "Permission denied"; })).rejects.toThrow('/notes/themes/workshop.css: Permission denied');
});

it("accepts themes with embedded artwork up to 16 MiB and measures UTF-8 bytes", async () => {
  const prefix = '/* @theme demo */\n/*';
  const css = prefix + ' '.repeat(16 * 1024 * 1024 - prefix.length - 2) + '*/';
  expect((await loadMarpTheme("/notes", "Slides.md", "demo", null, async () => css)).css).toBe(css);
  await expect(loadMarpTheme("/notes", "Slides.md", "demo", null, async () => css + 'é')).rejects.toThrow('exceeds the 16 MiB limit');
  await expect(loadMarpTheme("/notes", "Slides.md", "demo", null, async () => { throw 'This theme exceeds the 16 MiB limit.'; })).rejects.toThrow('exceeds the 16 MiB limit');
});

it("still uses a valid library theme if a local theme is invalid", async () => {
  const css = '/* @theme demo */ section { color: red; }';
  expect((await loadMarpTheme("/notes", "Slides.md", "demo", "/library", async () => '/* @theme wrong */', async () => css)).css).toBe(css);
});

it("validates large embedded images without overflowing the regular expression stack", async () => {
  const source = 'data:image/png;base64,' + 'AAAA'.repeat(1400000);
  const css = `/* @theme demo */ section { background: url("${source}"); }`;
  const loaded = await loadMarpTheme("/notes", "Slides.md", "demo", null, async () => css);
  expect(loaded.images.has(source)).toBe(true);
  expect(loaded.warning).toBe("");
});
