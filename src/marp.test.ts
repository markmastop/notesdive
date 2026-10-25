import { expect, it } from "vitest";
import { isMarp, renderMarp } from "./marp";
import { localMarpBackground, safeMarpCss, safeMarpStyle } from "./marpStyles";

const deck = (body: string, frontmatter = "") => `---\nmarp: true\n${frontmatter}---\n${body}`;

it("detects BOM/CRLF front matter and uses Markdown slide breaks without splitting comments or code", () => {
  expect(isMarp("\uFEFF---\r\nmarp: true # presentation\r\n---\r\n# One")).toBe(true);
  expect(isMarp("# Plain Markdown")).toBe(false);
  const result = renderMarp(deck('# One\n\n```md\n---\n<!-- example -->\n```\n\n<!--\nSpeaker notes\n---\nMore notes\n-->\n\n---\n# Two'));
  expect(result.slides).toHaveLength(2);
  expect(result.slides[0].html).toContain("One</h1>");
  expect(result.slides[0].html).toContain("&lt;!-- example --&gt;");
  expect(result.slides[0].notes).toEqual(["Speaker notes\n---\nMore notes"]);
  expect(result.slides[1].html).toContain("Two</h1>");
});

it("keeps speaker notes separate and applies inherited and scoped directives", () => {
  const result = renderMarp(deck('<!-- color: red -->\n# One\n<!-- Speaker notes -->\n---\n<!-- _class: lead -->\n<!-- _color: blue -->\n<!-- _paginate: false -->\n# Two\n---\n# Three', 'paginate: true\nheader: Workshop\nfooter: Team\n'));
  expect(result.slides[0].html).toContain('data-marpit-pagination="1"');
  expect(result.slides[0].html).toContain("<header>Workshop</header>");
  expect(result.slides[0].html).toContain("<footer>Team</footer>");
  expect(result.slides[1].html).toContain('class="lead"');
  expect(result.slides[1].html).toContain("color:blue");
  expect(result.slides[1].html).not.toContain('data-marpit-pagination="');
  expect(result.slides[2].html).not.toContain('class="lead"');
  expect(result.slides[2].html).toContain("color:red");
  expect(result.slides[0].html).not.toContain("Speaker notes");
  expect(result.slides.map((slide) => slide.notes)).toEqual([["Speaker notes"], [], []]);
});

it.each(["default", "gaia", "uncover"])("renders the official %s theme and 4:3 size", (theme) => {
  const result = renderMarp(deck("# Title", `theme: ${theme}\nsize: 4:3\n`));
  expect(result.width).toBe(960);
  expect(result.height).toBe(720);
  expect(result.css).toContain("section");
  expect(result.css).toContain("960px");
  expect(result.slides[0].html).toContain('data-size="4:3"');
});

it("honors theme CSS and heading dividers without leaking settings into the next deck", () => {
  const result = renderMarp(deck('# One\n\n## Two\n\nText', 'headingDivider: 2\nstyle: |\n  section { color: #123456; }\n'));
  expect(result.slides).toHaveLength(2);
  expect(result.css).toContain("#123456");
  expect(renderMarp(deck("# Plain")).css).not.toContain("#123456");
});

it("renders safe links and local image dimensions while keeping active HTML and image URLs inert", () => {
  const result = renderMarp(deck('<script>window.x=1</script>\n\n[Website](https://example.com/a)\n\n![width:300px](photo.png)\n\n![bg right](https://example.com/tracker.png)\n\n<!-- backgroundImage: url(https://example.com/second.png) -->'));
  expect(result.slides[0].html).not.toContain("<script>");
  expect(result.slides[0].html).not.toMatch(/\bsrc=/);
  expect(result.slides[0].html).toContain('data-web-link href="https://example.com/a"');
  expect(result.slides[0].html).toContain('data-marp-image="photo.png"');
  expect(result.slides[0].html).toContain("width:300px");
  expect(result.slides[0].html).toContain('data-marp-background="');
  expect(result.slides[0].html).not.toMatch(/style="[^"]*url\([^)]*https/);
});

it("blocks CSS fetches, including escaped URL functions and image-set, but retains typography and gradients", () => {
  const css = safeMarpCss('@import "https://example.com/a.css"; @font-face { font-family:x; src:url(https://example.com/font); } section { color:red; --image: u\\72l(https://example.com/a); background: image-set("https://example.com/b" 1x); mask:URL(https://example.com/c); background-image:linear-gradient(red, blue); }');
  expect(css).not.toContain("https://");
  expect(css).toContain("color:red");
  expect(css).toContain("linear-gradient(red, blue)");
  const style = safeMarpStyle('color:blue;background-image:url("photo.png");');
  expect(style.css).not.toContain("photo.png");
  expect(style.background).toBe('url("photo.png")');
});

it("renders HTML layouts and inline formatting, routing HTML assets and links through the viewer", () => {
  const result = renderMarp(deck('<div class="twee-kanten" style="display:grid;grid-template-columns:1fr 1fr"><div><h2>Jij houdt de regie</h2><ul><li>Kiest de gebruikershandeling</li></ul></div><div><h2>AI helpt bouwen</h2><ul><li>Stelt code voor</li></ul></div></div>\n\nEen <strong>prompt</strong>.\n\n<img src="diagram.svg" width="180" onerror="window.x=1"><img src="https://example.com/tracker" srcset="https://example.com/other 2x">\n\n<a href="https://example.com/workshop" onclick="window.x=1">Website</a>\n\n<a href="javascript:alert(1)">Invalid</a>\n\n<iframe src="https://example.com/frame"></iframe>\n\n<div style="color:red;background:url(https://example.com/background)">Text</div>'));
  const html = result.slides[0].html;
  expect(html).toContain('<div class="twee-kanten"');
  expect(html).toContain("grid-template-columns:1fr 1fr");
  expect(html).toContain("<h2>Jij houdt de regie</h2><ul><li>");
  expect(html).toContain("<strong>prompt</strong>");
  expect(html).toContain('data-marp-image="diagram.svg"');
  expect(html).toContain('data-marp-image="https://example.com/tracker"');
  expect(html).toContain('<a data-web-link href="https://example.com/workshop">');
  expect(html).not.toMatch(/<[^>]*\s(?:src|srcset|onerror|onclick)=/);
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<iframe");
  expect(html).not.toMatch(/style="[^"]*https:/);
});

it("resolves only local background images through the supplied scoped reader", async () => {
  const result = await localMarpBackground('url("photo.png"), url("https://example.com/a"), linear-gradient(red, blue)', async (source) => source === "photo.png" ? "data:image/png;base64,abc" : null);
  expect(result).toContain('url("data:image/png;base64,abc")');
  expect(result).not.toContain("https://");
  expect(result).toContain("linear-gradient(red, blue)");
});


it("maps editable slide ranges to original CRLF source without splitting code or notes", () => {
  const header = "---\r\nmarp: true\r\n---\r\n";
  const first = "# First\r\n\r\n```md\r\n---\r\n```\r\n<!--\r\nNotes\r\n---\r\n-->\r\n";
  const second = "# Second\r\n";
  const text = header + first + "---\r\n" + second;
  const rendered = renderMarp(text);
  expect(rendered.sources.map(({ from, to }) => text.slice(from, to))).toEqual([first, second]);
  const { from, to } = rendered.sources[1];
  expect(text.slice(0, from) + "# Edited\r\n" + text.slice(to)).toBe(header + first + "---\r\n# Edited\r\n");
});
