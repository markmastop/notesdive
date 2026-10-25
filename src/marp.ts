import { Marp } from "@marp-team/marp-core";
import type Token from "markdown-it/lib/token.mjs";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import { safeMarpCss, safeMarpStyle } from "./marpStyles";
import { webUrl } from "./webLinks";

export { isMarp } from "./isMarp";

export type MarpDeck = {
  css: string;
  width: number;
  height: number;
  theme: string;
  slides: { html: string; notes: string[] }[];
  sources: { from: number; to: number }[];
};

function marpHtml() {
  // Retain Marp's element/attribute allowlist, with the same resource policy as
  // Markdown slides. Raw HTML never loads images or media directly.
  const allowed: Record<string, Record<string, boolean | ((value: string) => string)>> = Object.fromEntries(Object.entries(Marp.html).map(([tag, attrs]) => {
    const attributes = Array.isArray(attrs) ? Object.fromEntries(attrs.map((name) => [name, true])) : attrs;
    return [tag, { ...attributes, src: false, srcset: false, poster: false,
      style: (value: string) => { try { return safeMarpStyle(value).css; } catch { return ""; } },
    }];
  }));
  allowed.img.src = true;
  allowed.a = { ...allowed.a, href: (value: string) => webUrl(value) || "", target: false };
  return allowed;
}

export function renderMarp(text: string, themeCss?: string, themeImages: ReadonlyMap<string, string> = new Map()): MarpDeck {
  // Use a fresh engine so directives and scoped styles cannot leak between notes.
  // Native HTML avoids WebKit's SVG foreignObject paint/hit-test mismatch.
  const engine = new Marp({ inlineSVG: false, cssContainerQuery: false, html: marpHtml(), script: false, math: false, emoji: { shortcode: true, unicode: false } });
  for (const type of ["html_inline", "html_block"]) {
    const render = engine.markdown.renderer.rules[type] as RenderRule;
    const renderHtml: RenderRule = (...args) => render(...args)
      // Marp has already sanitized tags and quoted attribute values here.
      .replace(/<img\b[^>]*>/g, (tag) => tag.replace(/\ssrc="([^"]*)"/g, ' data-marp-image="$1"'))
      .replace(/<a\b/g, "<a data-web-link");
    engine.markdown.renderer.rules[type] = renderHtml;
  }
  if (themeCss) engine.themeSet.add(safeMarpCss(themeCss, true, themeImages));
  let theme = "default";
  // Marpit discards unregistered theme names. Capture its availability checks
  // during directive parsing so the viewer can resolve a library CSS file.
  const hasTheme = engine.themeSet.has.bind(engine.themeSet);
  let parsingDirectives = true;
  engine.themeSet.has = (name) => {
    if (parsingDirectives) theme = String(name);
    return hasTheme(name);
  };
  engine.markdown.core.ruler.after("marpit_directives_global_parse", "notesdive_requested_theme", () => { parsingDirectives = false; });
  engine.markdown.core.ruler.push("notesdive_local_assets", ({ tokens }: { tokens: Token[] }) => {
    const visit = (token: Token) => {
      if (token.type === "image") {
        const source = token.attrGet("src");
        token.attrs = token.attrs?.filter(([name]) => name !== "src") || null;
        if (source) token.attrSet("data-marp-image", source);
      }
      const style = token.attrGet("style");
      if (style) {
        const safe = safeMarpStyle(style);
        token.attrSet("style", safe.css);
        if (safe.background) token.attrSet("data-marp-background", safe.background);
      }
      token.children?.forEach(visit);
    };
    tokens.forEach(visit);
  });
  engine.markdown.renderer.rules.link_open = (tokens: Token[], index: number) => {
    const url = webUrl(tokens[index].attrGet("href") || "");
    return url ? `<a data-web-link href="${engine.markdown.utils.escapeHtml(url)}">` : "<span>";
  };
  engine.markdown.renderer.rules.link_close = (tokens: Token[], index: number) => {
    const opening = tokens.slice(0, index).reverse().find((token) => token.type === "link_open");
    return webUrl(opening?.attrGet("href") || "") ? "</a>" : "</span>";
  };
  const sources: MarpDeck["sources"] = [];
  engine.markdown.core.ruler.before("marpit_slide", "notesdive_slide_sources", (state: { tokens: Token[] }) => {
    // Use the same parsed top-level rules as Marpit: code fences, HTML comments,
    // nested rules and YAML front matter must never become slide boundaries.
    const offsets = [0];
    for (const line of text.matchAll(/\r\n|\r|\n/g)) offsets.push(line.index! + line[0].length);
    const offset = (line: number) => offsets[line] ?? text.length;
    const front = state.tokens.find((token) => token.type === "front_matter");
    let from = front?.map ? offset(front.map[1]) : 0;
    for (const token of state.tokens) {
      if (token.type !== "hr" || token.level !== 0 || !token.map) continue;
      sources.push({ from, to: offset(token.map[0]) });
      from = offset(token.map[1]);
    }
    sources.push({ from, to: text.length });
  });
  const result = engine.render(text, { htmlAsArray: true });
  const dimensions = [...result.css.matchAll(/section\{width:([\d.]+)px;height:([\d.]+)px\}/g)].slice(-1)[0];
  const selectedTheme = engine.themeSet.get(theme) || engine.themeSet.get("default");
  return {
    css: safeMarpCss(result.css, false, new Map([...themeImages.values()].map((data) => [data, data]))),
    width: Number(dimensions?.[1]) || selectedTheme?.widthPixel || 1280,
    height: Number(dimensions?.[2]) || selectedTheme?.heightPixel || 720,
    theme,
    sources,
    slides: result.html.map((html, index) => ({ html, notes: result.comments[index] || [] })),
  };
}
