// Only this application-owned bridge may run; document scripts stay blocked.
import linkBridgeUrl from "./htmlLinkBridge.js?no-inline&url";

export function isolatedPage(content: string, zoom = 1, { fullWidth = false, linkNavigation = false }: { fullWidth?: boolean; linkNavigation?: boolean } = {}): string {
  const template = document.createElement("template");
  template.innerHTML = content;
  // Keep link resolution under the viewer's control and prevent automatic navigation.
  for (const node of template.content.querySelectorAll("base, meta[http-equiv], script")) node.remove();
  for (const table of template.content.querySelectorAll("table")) {
    const wrapper = document.createElement("div");
    wrapper.className = "document-table-scroll";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Document table — scroll horizontally to see all columns");
    wrapper.tabIndex = 0;
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  const nonce = linkNavigation ? crypto.randomUUID().replaceAll("-", "") : "";
  const scriptPolicy = nonce ? `; script-src 'nonce-${nonce}'` : "";
  const bridge = nonce ? `<script nonce="${nonce}" src="${new URL(linkBridgeUrl, window.location.href).href}"></script>` : "";
  const layout = fullWidth
    ? `<style>html,body{width:100%!important;max-width:none!important;box-sizing:border-box}body{margin:0!important}body>main,body>article,body>.wrap,body>.wrapper,body>.container,body>#root,body>#app{width:auto!important;max-width:none!important}</style>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:${scriptPolicy}"><style>html{background:#fff;color:#263044;font:${16 * zoom}px/1.55 system-ui,sans-serif}body{max-width:900px;margin:32px auto;padding:0 24px;overflow-wrap:anywhere}img,svg,video{max-width:100%;height:auto}.document-table-scroll{max-width:100%;overflow-x:auto;margin:1em 0}.document-table-scroll:focus-visible{outline:2px solid #587b62;outline-offset:2px}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.5}td,th{border:1px solid #dce3d2;padding:.55em .65em;min-width:8ch;overflow-wrap:normal;word-break:normal;vertical-align:top}th{background:#f3f5f0}td p,th p{margin:.35em 0}</style></head><body>${template.innerHTML}${layout}${bridge}</body></html>`;
}
