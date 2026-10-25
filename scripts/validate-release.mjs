import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function validateReleaseInputs({ tag, versions, notes }) {
  assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Use a stable tag such as v0.19.0");
  const version = tag.slice(1);
  for (const [file, value] of Object.entries(versions)) {
    assert.equal(value, version, `${file} must match tag ${tag}`);
  }
  assert.ok(notes.startsWith(`# NotesDive ${version} `), "Release notes must name the tagged version");
  assert.ok(notes.trim().split("\n").length > 2, "Write release notes before tagging");
  return version;
}

export async function validateRepository(tag, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const json = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
  const pkg = await json("package.json");
  const lock = await json("package-lock.json");
  const tauri = await json("src-tauri/tauri.conf.json");
  const cargo = await readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = await readFile(path.join(root, "src-tauri/Cargo.lock"), "utf8");
  const cargoVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
  const cargoLockVersion = cargoLock.match(/\[\[package\]\]\nname = "notesdive"\nversion = "([^"]+)"/)?.[1];
  const notes = await readFile(path.join(root, `docs/releases/v${pkg.version}.md`), "utf8");
  validateReleaseInputs({ tag, versions: {
    "package.json": pkg.version, "package-lock.json": lock.version,
    "package-lock.json root": lock.packages?.[""]?.version,
    "tauri.conf.json": tauri.version, "Cargo.toml": cargoVersion, "Cargo.lock": cargoLockVersion,
  }, notes });
  if (process.env.GITHUB_REPOSITORY) {
    const config = await json("release-config.json");
    assert.equal(config.repository.toLowerCase(), process.env.GITHUB_REPOSITORY.toLowerCase(), "Update release-config.json for this repository");
  }
  return pkg.version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = await validateRepository(process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "");
  console.log(`Validated release v${version}`);
}
