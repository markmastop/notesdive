# NotesDive

Your notes. Your files. Your space.

A desktop workspace for local Markdown notes, documents and projects, built with Tauri, React and TypeScript. Your notes stay in ordinary files in the folders you choose. Local notes work offline without a NotesDive account.

## Features

- Write Markdown in a visual editor or edit the source, with autosave and conflict handling.
- Organize folders into projects and collect tasks, links and recent documents on Home.
- View PDF, EPUB, Word, PowerPoint, HTML, text and image files.
- Create, edit and present Marp slides, including custom local themes.
- Export documents and presentations to PDF locally.
- Optionally connect reMarkable for supported previews, PDF export and manual folder sync. This connection requires internet.

## Download

See [GitHub Releases](https://github.com/markmastop/notesdive/releases) for published installers. The release workflow currently targets **macOS Apple Silicon**. Builds use an ad-hoc signature and are not notarized, so macOS may show a Gatekeeper warning.

## Run locally

Install Node.js **22.12+**, a recent stable Rust toolchain and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system.

```sh
git clone https://github.com/markmastop/notesdive.git
cd notesdive
npm ci
npm run tauri dev
```

Use `npm run tauri dev` for the desktop app; `npm run dev` starts only the browser UI. Build and test instructions are in the [development guide](docs/development.md).

## Documentation

- [User guide](docs/user-guide.md) — editing, libraries, projects, presentations and exports.
- [Development guide](docs/development.md) — setup, builds, tests and project structure.
- [reMarkable folder sync](docs/remarkable-folder-sync.md) — supported transfers and limitations.
- [Markdown task syntax](docs/supported-tags.md) — checkboxes, dates, priorities and tags.
- [GitHub Releases](docs/github-releases.md) — version tags, installers and update checks.
- [Roadmap](docs/roadmap.md) — plans and their status at the stated date.

## License

NotesDive source code and compiled app are licensed under [MIT](LICENSE). External components retain their own licenses; see [third-party notices](THIRD-PARTY-NOTICES.txt).
