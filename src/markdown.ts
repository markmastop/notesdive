import MarkdownIt from "markdown-it";
import { webUrl } from "./webLinks";
const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
// Notes are untrusted local text. Reading a note must not contact image servers
// or navigate the app away from the editor. Web links open only through the
// validated native browser command when clicked by the user.
md.renderer.rules.image = (tokens, idx) => {
  const alt = tokens[idx].content || "image";
  return `<span class="image-placeholder" data-local-image="${md.utils.escapeHtml(tokens[idx].attrGet("src") || "")}" data-image-alt="${md.utils.escapeHtml(alt)}">[Image: ${md.utils.escapeHtml(alt)}]</span>`;
};
md.renderer.rules.link_open = (tokens, idx) => {
  const href = webUrl(tokens[idx].attrGet("href") || "");
  return href ? `<a class="preview-link" data-web-link href="${md.utils.escapeHtml(href)}">` : `<span class="preview-link">`;
};
md.renderer.rules.link_close = (tokens, idx) => {
  const opening = tokens.slice(0, idx).reverse().find((token) => token.type === "link_open");
  return opening && webUrl(opening.attrGet("href") || "") ? "</a>" : "</span>";
};
export function renderMarkdown(text: string) {
  return md.render(text);
}
