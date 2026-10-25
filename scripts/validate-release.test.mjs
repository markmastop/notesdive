import { test } from "node:test";
import assert from "node:assert/strict";
import { validateReleaseInputs, validateRepository } from "./validate-release.mjs";

const input = { tag: "v0.19.0", versions: { npm: "0.19.0", tauri: "0.19.0", cargo: "0.19.0" }, notes: "# NotesDive 0.19.0 — Release\n\nA tested release.\n" };
test("accepts aligned stable release inputs", () => {
  assert.equal(validateReleaseInputs(input), "0.19.0");
});
test("rejects mismatched versions, unsafe tags, and missing notes", () => {
  for (const tag of ["0.19.0", "v01.19.0", "v0.19.0-beta.1", "v0.19.0/other", "v0.19.0\n"]) {
    assert.throws(() => validateReleaseInputs({ ...input, tag }));
  }
  assert.throws(() => validateReleaseInputs({ ...input, versions: { ...input.versions, cargo: "0.18.9" } }));
  assert.throws(() => validateReleaseInputs({ ...input, notes: "# NotesDive 0.18.9 — Old\n\nOld notes" }));
  assert.throws(() => validateReleaseInputs({ ...input, notes: "# NotesDive 0.19.0 — Release" }));
});
test("repository release versions and notes remain aligned", async () => {
  const { version } = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(await validateRepository(`v${version}`), version);
});
