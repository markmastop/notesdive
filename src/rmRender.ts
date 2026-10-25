import { parse, renderToSvg } from "remarkable-rm";

export interface RenderedRmPage { svg: string; width: number; height: number }
export function renderRmPage(bytes: Uint8Array): RenderedRmPage {
  if (bytes.length > 20 * 1024 * 1024) throw new Error("This notebook page exceeds the 20 MiB viewer limit.");
  const document = parse(bytes);
  const svg = renderToSvg(document);
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))
      || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error("This page has invalid drawing dimensions.");
  if (svg.length > 32 * 1024 * 1024) throw new Error("This page is too complex to display.");
  return { svg, width: viewBox[2], height: viewBox[3] };
}
