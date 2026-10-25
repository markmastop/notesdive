# GitHub Releases

Pushing a stable version tag such as `v0.19.0` triggers `.github/workflows/release.yml`. It builds the macOS Apple Silicon installer on an ARM64 macOS runner. Windows, Linux, and Intel macOS installers are not built by this workflow.

## Prepare a version

1. Update the same version in `package.json`, `package-lock.json` (including its root package entry), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the NotesDive package entry in `src-tauri/Cargo.lock`.
2. Write `docs/releases/v<version>.md`, starting with `# NotesDive <version> `, followed by changes, supported platform, and material limitations.
3. Run `node scripts/validate-release.mjs v<version>`, `npm run check`, `npm run test:release`, `cargo test --locked --manifest-path src-tauri/Cargo.toml`, and `npm run test:e2e`. Install Playwright browsers once using `npx playwright install chromium webkit`.
4. Commit the tested source and push the commit. Create and push the tag on that commit only when ready to publish. For example, for a prepared 0.19.0 release:

```sh
git tag -a v0.19.0 -m "NotesDive 0.19.0"
git push origin v0.19.0
```

Pushing the tag publishes automatically once all checks pass. Pushing ordinary commits does not publish a release. The workflow must be included in the tagged commit.

## Build and publication

The workflow validates the tag against npm, Tauri, and Rust versions and release notes before building. It runs frontend, native, browser, and release-validation tests, builds the DMG, then verifies its app signature and bundled licenses. `npm run release:mac` remains available locally and prepares the same files under ignored `release/v<version>/`.

After successful verification, the workflow creates a draft GitHub Release, attaches the DMG, release notes, MIT license, and third-party notices and licenses, then publishes it as a stable release. The installer is named `NotesDive-macOS-Apple-Silicon.dmg`. Nothing is committed back to the repository.

A failed upload leaves a draft; rerunning the failed workflow can finish it. A published release is never overwritten by a rerun. Fixes to published software need a new version and tag.

GitHub Actions must be enabled and permitted to use the job's `contents: write` permission. Publication uses the built-in `GITHUB_TOKEN`; no personal access token or additional release secret is required. Organization policies can restrict Actions or token permissions.

The app retains its ad-hoc signature and is not notarized. The workflow does not configure Apple Developer signing or notarization.

## Update checks

The app uses the public GitHub API's latest stable release endpoint. `release-config.json` defines the repository and required installer name. A release is offered only when its stable `vX.Y.Z` tag is newer than the installed version and its matching installer is fully uploaded. Download and release-note actions open that exact version in the system browser. Installation remains manual.

Checks run automatically at most once per 24 hours; the manual check bypasses the local cache. Offline checks, missing/private releases, and API rate limits do not block editing. A previously discovered update remains available after a failed check. No credentials, note content, or workspace paths are sent.

Make the repository public before expecting anonymous update checks and public downloads to work. This code change does not alter repository visibility or publish an initial release. Existing installed versions still using the former website endpoint need a manual upgrade to a build with GitHub update support.

Official references: [GitHub Releases API](https://docs.github.com/en/rest/releases/releases), [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), and [GitHub CLI releases](https://cli.github.com/manual/gh_release_create).
