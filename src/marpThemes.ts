import { invoke } from "@tauri-apps/api/core";
import { localImagePath } from "./localImages";
import { marpCssImageSources } from "./marpStyles";

export type MarpTheme = { css: string; images: Map<string, string>; warning: string };
const maxThemeBytes = 16 * 1024 * 1024;

export function marpThemeImagePath(cssPath: string, source: string): string | null {
  const path = localImagePath(cssPath, source);
  const directory = cssPath.slice(0, cssPath.lastIndexOf("/") + 1);
  return path?.startsWith(directory) ? path : null;
}

export const builtinMarpThemes = new Set(["default", "gaia", "uncover"]);

export function marpThemePaths(notePath: string, name: string): string[] {
  if (!/^[a-z\d][a-z\d_-]*$/i.test(name)) return [];
  const directory = notePath.split("/").slice(0, -1).join("/");
  return [...new Set([directory ? `${directory}/themes/${name}.css` : `themes/${name}.css`, `themes/${name}.css`])];
}

export async function loadMarpTheme(folder: string, notePath: string, name: string,
  library: string | null = null,
  read: (path: string) => Promise<string> = (path) => invoke("read_marp_theme", { folder, path }),
  readLibrary: () => Promise<string> = () => invoke("read_library_marp_theme", { library, name }),
  readImage: (root: string, path: string, shared: boolean) => Promise<{ mime: string; data: string }> = (root, path, shared) => shared
    ? invoke("read_library_marp_image", { library: root, path }) : invoke("read_asset", { folder: root, path }),
): Promise<MarpTheme> {
  const paths = marpThemePaths(notePath, name);
  if (!paths.length) throw new Error(`Invalid theme name "${name}". Use letters, numbers, dashes or underscores.`);
  const readers = paths.map((path) => ({ read: () => read(path), root: folder, path, shared: false }));
  if (library && paths.length) readers.push({ read: readLibrary, root: library, path: `themes/${name}.css`, shared: true });
  const failures: string[] = [];
  for (const reader of readers) {
    try {
      const css = await reader.read();
      if (new TextEncoder().encode(css).byteLength > maxThemeBytes) throw new Error("This theme exceeds the 16 MiB limit. Reduce embedded images or store them beside the CSS file.");
      if (!new RegExp(`@theme\\s+${name}(?:\\s|\\*/|$)`).test(css)) throw new Error(`The CSS must declare /* @theme ${name} */ to match the requested theme.`);
      const images = new Map<string, string>();
      const embeddedImage = /^data:image\/(?:png|jpeg|svg\+xml);base64,/;
      const sources = marpCssImageSources(css).filter((source) =>
        marpThemeImagePath(reader.path, source) || source.startsWith("data:"));
      let total = 0;
      let unavailable = sources.length > 32;
      for (const source of sources.slice(0, 32)) {
        try {
          // Theme builders can embed their artwork instead of writing separate files.
          // Admit only bounded base64 images to the same explicit CSS allowlist.
          if (source.startsWith("data:")) {
            const header = source.match(embeddedImage)?.[0];
            const data = header ? source.slice(header.length) : "";
            // A flat character class avoids regex stack overflow on large artwork.
            if (!header || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || total + source.length > 32 * 1024 * 1024) throw Error("Image unavailable");
            total += source.length;
            images.set(source, source);
            continue;
          }
          const asset = await readImage(reader.root, marpThemeImagePath(reader.path, source)!, reader.shared);
          // Bound image memory as well as CSS. Only scoped readers supply URLs.
          if (!["image/png", "image/jpeg", "image/svg+xml"].includes(asset.mime) || total + asset.data.length > 32 * 1024 * 1024) throw Error("Image unavailable");
          total += asset.data.length;
          images.set(source, `data:${asset.mime};base64,${asset.data}`);
        } catch { unavailable = true; }
      }
      return { css, images, warning: unavailable ? "Some theme images are unavailable. Check the theme's image folder and reload." : "" };
    } catch (error) {
      // Keep trying fallback locations, but retain errors other than a missing file.
      const message = error instanceof Error ? error.message : String(error);
      if (!/^(?:Theme file not found:|Missing$)|No such file or directory|os error 2\)/i.test(message)) {
        failures.push(`${reader.root}/${reader.path}: ${message}`);
      }
    }
  }
  if (failures.length) throw new Error(`Theme "${name}" could not be loaded. ${failures.join("; ")} Fix the file and reload the theme.`);
  throw new Error(`Theme "${name}" not found. Add themes/${name}.css beside the presentation or in the notes root${library ? " or active library" : ""}, with /* @theme ${name} */, and reload the theme.`);
}
