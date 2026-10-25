import postcss from "postcss";
import valueParser from "postcss-value-parser";

function cssIdentifier(value: string): string {
  return value.replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_, hex: string, char: string) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : char).toLowerCase();
}

export function withoutMarpUrls(value: string, images: ReadonlyMap<string, string> = new Map()): string {
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type === "function" && ["url", "src", "image", "image-set", "-webkit-image-set"].includes(cssIdentifier(node.value))) {
      const image = cssIdentifier(node.value) === "url" && node.nodes.length === 1 ? images.get(node.nodes[0].value) : undefined;
      node.value = "url";
      node.nodes = [{ type: "string", quote: '"', value: image || "", sourceIndex: 0, sourceEndIndex: 0 }];
      return false;
    }
  });
  return parsed.toString();
}

export function marpCssImageSources(css: string): string[] {
  const sources = new Set<string>();
  postcss.parse(css).walkDecls((declaration) => {
    valueParser(declaration.value).walk((node) => {
      if (node.type === "function" && cssIdentifier(node.value) === "url") {
        if (node.nodes.length === 1) sources.add(node.nodes[0].value);
        return false;
      }
    });
  });
  return [...sources];
}

export function safeMarpCss(css: string, themeImports = false, images: ReadonlyMap<string, string> = new Map()): string {
  const root = postcss.parse(css);
  root.walkAtRules((rule) => {
    if (cssIdentifier(rule.name) === "import" && themeImports && /^(['"])(default|gaia|uncover)\1$/.test(rule.params.trim())) return;
    if (["import", "font-face", "namespace"].includes(cssIdentifier(rule.name))) rule.remove();
    else rule.params = withoutMarpUrls(rule.params);
  });
  root.walkDecls((declaration) => { declaration.value = withoutMarpUrls(declaration.value, images); });
  return root.toString();
}

export function safeMarpStyle(css: string): { css: string; background?: string } {
  const root = postcss.parse(`section{${css}}`);
  let background: string | undefined;
  root.walkDecls((declaration) => {
    if (cssIdentifier(declaration.prop) === "background-image" && declaration.value !== withoutMarpUrls(declaration.value)) {
      background = declaration.value;
    }
    declaration.value = withoutMarpUrls(declaration.value);
  });
  return { css: root.first?.type === "rule" ? root.first.nodes.map((node) => node.toString()).join(";") : "", background };
}

// Only the existing workspace-scoped image reader may resolve these URLs.
export async function localMarpBackground(value: string, read: (source: string) => Promise<string | null>): Promise<string> {
  const parsed = valueParser(value);
  const jobs: Promise<void>[] = [];
  parsed.walk((node) => {
    if (node.type !== "function") return;
    if (cssIdentifier(node.value) === "url") {
      const source = node.nodes.length === 1 ? node.nodes[0].value : "";
      jobs.push(read(source).then((data) => {
        node.value = "url";
        node.nodes = [{ type: "string", quote: '"', value: data || "", sourceIndex: 0, sourceEndIndex: 0 }];
      }));
      return false;
    }
    if (["src", "image", "image-set", "-webkit-image-set"].includes(cssIdentifier(node.value))) {
      node.value = "url";
      node.nodes = [{ type: "string", quote: '"', value: "", sourceIndex: 0, sourceEndIndex: 0 }];
      return false;
    }
  });
  await Promise.all(jobs);
  return parsed.toString();
}
