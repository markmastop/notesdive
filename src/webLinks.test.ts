import { expect, it } from "vitest";
import { webUrl } from "./webLinks";

it("allows only complete HTTP and HTTPS links", () => {
  expect(webUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
  expect(webUrl("notes.md")).toBeNull();
  expect(webUrl("file:///etc/passwd")).toBeNull();
  expect(webUrl("javascript:alert(1)")).toBeNull();
  expect(webUrl("https://example.com\n--args")).toBeNull();
});
