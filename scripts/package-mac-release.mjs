import assert from "node:assert/strict";
import { validateRepository } from "./validate-release.mjs";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = root;
const config = JSON.parse(
  await readFile(path.join(app, "src-tauri/tauri.conf.json"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(path.join(app, "package.json"), "utf8"),
);
const version = config.version;
await validateRepository(`v${version}`, root);
const releaseConfig = JSON.parse(await readFile(path.join(root, "release-config.json"), "utf8"));
assert.match(
  version,
  /^\d+\.\d+\.\d+$/,
  "Expected a stable semver app version",
);
assert.equal(
  packageJson.version,
  version,
  "App package and Tauri versions must match",
);
assert.equal(process.platform, "darwin", "Build this release on macOS");
assert.equal(process.arch, "arm64", "This release is for Apple Silicon");

const notes = path.join(root, `docs/releases/v${version}.md`);
const notesText = await readFile(notes, "utf8");
assert.ok(
  notesText.startsWith(`# NotesDive ${version} `),
  "Release notes must name this version",
);
const dmgDirectory = path.join(app, "src-tauri/target/release/bundle/dmg");
const dmgFiles = (await readdir(dmgDirectory)).filter(
  (name) => name.endsWith(".dmg") && name.includes(version),
);
assert.equal(
  dmgFiles.length,
  1,
  `Expected exactly one macOS DMG for ${version}`,
);
const image = path.join(dmgDirectory, dmgFiles[0]);
const mount = await mkdtemp(path.join(os.tmpdir(), "notesdive-dmg-"));
try {
  execFileSync("hdiutil", [
    "attach",
    "-readonly",
    "-nobrowse",
    "-mountpoint",
    mount,
    image,
  ]);
  execFileSync("codesign", ["--verify", "--deep", "--strict", path.join(mount, "NotesDive.app")]);
  const licensePath = path.join(
    mount,
    "NotesDive.app/Contents/Resources/LICENSE.txt",
  );
  assert.ok(
    (await readFile(licensePath, "utf8")).includes("MIT License"),
    "MIT license must be embedded in the DMG app",
  );
  assert.ok(
    (await readFile(path.join(mount, "NotesDive.app/Contents/Resources/THIRD-PARTY-NOTICES.txt"), "utf8")).includes("PDF.js"),
    "PDF.js notice must be embedded in the DMG app",
  );
  assert.ok(
    (await readFile(path.join(mount, "NotesDive.app/Contents/Resources/marp-LICENSE.txt"), "utf8")).includes("@marp-team/marp-core"),
    "Marp licenses must be embedded in the DMG app",
  );
} finally {
  try {
    execFileSync("hdiutil", ["detach", mount]);
  } catch {
    /* A failed mount has nothing to detach. */
  }
  await rm(mount, { recursive: true, force: true });
}
const downloadDir = path.join(root, "release", `v${version}`);
await mkdir(path.join(downloadDir, "releases"), { recursive: true });
const download = path.join(downloadDir, releaseConfig.asset);
await copyFile(path.join(dmgDirectory, dmgFiles[0]), download);
await copyFile(notes, path.join(downloadDir, "releases", `v${version}.md`));
await writeFile(path.join(downloadDir, "RELEASE_NOTES.md"), notesText.trim() + "\n");
for (const name of await readdir(downloadDir)) {
  if (/^NotesDive-macOS-Apple-Silicon-v\d+\.\d+\.\d+\.dmg$/.test(name)) {
    await rm(path.join(downloadDir, name));
  }
}
for (const name of await readdir(path.join(downloadDir, "releases"))) {
  if (/^v\d+\.\d+\.\d+\.md$/.test(name) && name !== `v${version}.md`) {
    await rm(path.join(downloadDir, "releases", name));
  }
}
await copyFile(
  path.join(app, "LICENSE"),
  path.join(downloadDir, "LICENSE.txt"),
);
await copyFile(path.join(app, "THIRD-PARTY-NOTICES.txt"), path.join(downloadDir, "THIRD-PARTY-NOTICES.txt"));
for (const name of (await readdir(path.join(app, "licenses"))).filter((file) => file.endsWith("-LICENSE.txt"))) {
  await copyFile(path.join(app, "licenses", name), path.join(downloadDir, name));
}
console.log(`Packaged NotesDive ${version} at ${download}`);
