# Working on NotesDive

## Project

- Work in this Git repository (`notesdive`).
- Preserve existing files and user changes.

## Automatic commits

- Make a local Git commit after each completed, coherent change without waiting for a separate request or confirmation.
- Run checks appropriate to the change before committing; fix failures caused by your change first. Report checks that could not be run.
- Review the diff and stage only files related to your change. Do not include unrelated existing user changes without permission.
- Use a short, clear commit message describing what changed.
- Do not commit dependencies, ordinary build outputs, temporary files, or secrets. Respect `.gitignore`.
- Report the commit ID and relevant check results briefly when finished.
- Automatic commits are local only. Push only when the user requests it.
- Do not run Wrangler, including for local development or website tests. A local Git commit is sufficient; only use Wrangler when the user explicitly requests it for that action. Use non-Wrangler build and validation tools instead.
- For release requests, including “roll out” or “uitrollen”, building the release and making a local commit is sufficient. Do not separately deploy to Cloudflare or push unless the user explicitly asks for that. When the user also requests a local Apps installation, update `/Applications/NotesDive.app` with the tested release.
- An explicit request not to commit takes precedence over this default.

## Repository layout

- The repository root contains the Tauri desktop app (`src/`, `src-tauri/`, and npm configuration); `docs/` contains supporting documentation, and `scripts/` contains release packaging tools.
- Run npm commands from the repository root. Keep local desktop functionality independent of the externally hosted website.
- Website source is no longer maintained in this repository. App update checks use public GitHub Releases configured in `release-config.json`.

## Markdown task convention

- Use GitHub Flavored Markdown checkbox tasks (`- [ ]` and `- [x]`) as the task source of truth.
- For new task properties, use Dataview-style inline fields on the same line: `[assignee:: @alex] [start:: YYYY-MM-DD] [due:: YYYY-MM-DD] [priority:: high] [stage:: doing]` and ordinary `#tags`.
- Valid priorities are `urgent`, `high`, `normal`, `medium`, and `low`; `medium` is an alias of `normal` for sorting. Valid stages are `backlog`, `todo`, `doing`, `review`, `blocked`, and `done`. Use one `@name` assignee per task. Dates must be valid ISO calendar dates.
- The checkbox controls completion. A checked task has effective stage `done`; an open task with no stage or with a written `done` stage has effective stage `todo`. The written stage is retained when the checkbox changes.
- Continue reading legacy `due:YYYY-MM-DD`, `start:YYYY-MM-DD`, and `priority:high|medium|low` fields. Keep invalid or unknown fields visible as ordinary text. Preserve unrelated Markdown when changing a checkbox.
- `docs/supported-tags.md` is the public syntax reference. Distinguish the packaged download from unreleased development behavior there. Do not claim a Kanban board or metadata editing controls exist until shipped.
- When moving files, also check CI paths and README instructions. Deploy or push only on request.
- Keep repository documentation in English.

## Releases and licensing

- NotesDive source code and compiled desktop binaries are licensed under the MIT License in the root `LICENSE`. Third-party components retain their own licenses and notices.
- For every new app version, update `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` and write short release notes at `docs/releases/v<version>.md` before packaging. State important changes, supported platform, and material limitations.
- Bundle required third-party notices alongside the MIT license whenever new dependencies are shipped.
- On Apple Silicon macOS, run `npm run release:mac` from the repository root to build and verify the app and prepare ignored `release/v<version>/` output with the DMG, notes, and licenses. Keep installers and other build outputs out of Git.
- Run appropriate app checks before committing. Publishing releases or changing external hosting requires a user request.
- `.github/workflows/release.yml` builds, tests, and publishes macOS Apple Silicon releases when a stable `vX.Y.Z` tag is pushed. Keep tag, versions, and release notes aligned. Do not push a release tag unless requested; it publishes automatically.
