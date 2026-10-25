import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderRmPage } from "./rmRender";
const fixture = (version: number) => new Uint8Array(readFileSync(new URL(`../tests/fixtures/remarkable/v${version}-sample.rm`, import.meta.url)));

describe("reMarkable page rendering", () => {
  it("renders legacy v5 handwriting to scalable SVG", () => {
    const page = renderRmPage(fixture(5));
    expect(page.svg).toContain("<polyline");
    expect(page.width).toBeGreaterThan(0);
    expect(page.height / page.width).toBeCloseTo(1872 / 1404, 2);
  });
  it("renders a real v6 page with handwriting, typed text and coloured highlights", () => {
    const page = renderRmPage(fixture(6));
    expect(page.svg).toContain("<polyline");
    expect(page.svg).toContain("Text small and hilight");
    expect(page.svg).toContain("Numbered");
    expect(page.svg).not.toContain("NaN");
  });
  it("rejects truncated and unsupported files instead of showing an empty preview", () => {
    expect(() => renderRmPage(new Uint8Array(5))).toThrow(/Truncated/);
    const bytes = fixture(5); bytes[32] = 55;
    expect(() => renderRmPage(bytes)).toThrow(/Unsupported/);
    expect(() => renderRmPage(fixture(5).slice(0, 65))).toThrow();
  });
});
