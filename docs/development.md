# Developing NotesDive

[Back to the README](../README.md) · [User guide](user-guide.md)

Repository conventions are in [AGENTS.md](../AGENTS.md). Run all commands below from the repository root. See [GitHub Releases](github-releases.md) for automatic builds and publication from version tags.

## Requirements

- Node.js **22.12+** and npm.
- A recent stable Rust toolchain (`rustup`, `cargo`, `rustc`). Use current stable for the locked dependencies.
- The official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Windows:** Microsoft C++ Build Tools with Desktop development with C++, and Microsoft Edge WebView2.
  - **Linux (Ubuntu/Debian):** `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libwebkit2gtk-4.1-dev`, `libxdo-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `patchelf`, and a usable font.

Check `node --version`, `cargo --version`, and `rustc --version`. After installing Rust, you may need to reopen your terminal or run `source "$HOME/.cargo/env"`.

## Install and run

From the repository root:

```sh
npm ci
npm run tauri dev
```

Choose **Add folder** in Settings and select a Markdown folder. Add more folders whenever you like; NotesDive remembers them and reopens the last active one next time. Switching folders saves an open draft first. NotesDive does not create sample notes there.

`npm run dev` starts only the browser UI. A browser cannot access the local workspace, so it displays an explanation instead. Vite is used only during development; the built desktop app runs on its own.

## Build a release

Build on the platform for which you want to create a package:

```sh
npm run tauri build
```

Output is under `src-tauri/target/release/bundle/` (relative to the repository root): for example, `.app` / `.dmg` on macOS, Windows installers, or Linux packages. To make only a macOS app bundle:

```sh
npm run tauri build -- --bundles app
```

The app includes its own icon. Distribution to other users may require platform signing and, on macOS, notarization. Signing keys are not included.

## Distributing the macOS preview

The source code and compiled NotesDive app are distributed under the [MIT License](../LICENSE), which is bundled inside `NotesDive.app` and its release DMG. PDF.js and the Office viewers ship with [third-party notices](../THIRD-PARTY-NOTICES.txt) and their license texts in the app bundle.

On an Apple Silicon Mac, prepare a local release package from the repository root with:

```sh
npm run release:mac
```

Before running it, update the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` together and write short notes in `docs/releases/v<version>.md`. The command builds the macOS app, verifies its signature and embedded licenses in the DMG, and copies the installer, release notes, and licenses into ignored `release/v<version>/` output. It does not publish a download or update the live website. See [GitHub release publishing](github-releases.md) for the automatic tag workflow.

The macOS preview uses an ad-hoc signature and is not notarized, so macOS may show a Gatekeeper warning. A Windows or Linux download needs its own build and packaging before it can be advertised.

## Tests

From the repository root:

```sh
npm run check                           # Unit tests, TypeScript, and Vite build
npm run test:release                    # Release validation tests
cargo test --locked --manifest-path src-tauri/Cargo.toml
npx playwright install chromium webkit  # Install browsers once
npm run test:e2e
```

Unit tests cover delayed saves, typing while saving, save failures during navigation/quit or folder switching, external edits/deletions, CRLF/BOM handling, and safe preview. Native tests use real temporary directories and verify recursive search, conflicts, duplicate names, invalid UTF-8, supported assets, and path/symlink boundaries. Playwright scenarios run in both Chromium and WebKit. They cover library creation, switching, reopening, legacy imports, metadata conflicts and unavailable-library recovery, plus local PDF, image, HTML, DOCX, and PPTX viewing, formatted Markdown reading, toolbar actions, undo/redo, quick cursor movement, tasks, tables, source switches, preservation of metadata/links/image references, external changes, Home search and tasks across projects, folder shortcuts in Settings, task aggregation, filtering, safe task toggles, stale-task conflicts, Files spacing, focus mode, narrow windows, and draft preservation. They exercise the real React/CodeMirror/Milkdown viewer UI with a mocked Tauri bridge; they do not replace native platform testing.

Run these checks locally before committing changes.

## Project layout

```text
src/
  App.tsx           Workspace, navigation, search, and dialogs
  LibrarySettings.tsx Library creation, opening, selection, and migration in Settings
  libraries.ts     Library bridge and location types
  ProjectsView.tsx   Project overview, cross-folder results, and project settings
  projects.ts       Project bridge, resource identity, and aggregation
  DocumentsView.tsx Folder filter, note list, sorting, and scroll restoration
  HomeView.tsx      Cross-project Home dashboard
  home.ts           Home aggregation and recent work history
  WorkspaceViews.tsx Todos view
  todos.ts          Markdown task parser, in-memory index, safe task toggles
  useTodos.ts       Background scans and watcher updates
  Editor.tsx        CodeMirror 6 Markdown source editor
  RichEditor.tsx    Visual reading/editing, toolbar, and selection
  richMarkdown.ts  Front matter and visual editing limits
  session.ts        Document state, autosave, and conflicts
  api.ts            Typed Tauri bridge
  markdown.ts       Sandboxed Markdown rendering
  styles.css        NotesDive UI
src-tauri/
  src/files.rs      File reads, atomic saves, search, and path checks
  src/lib.rs        Native folder picker, config, watcher, and commands
  src/projects.rs   Legacy project metadata, folder picker, and scoped reads
  src/libraries.rs  Portable library/project files, local registry, and migration
  tauri.conf.json   Window, bundles, and content security policy
  capabilities/    Minimal webview permissions
```

The native layer is embedded in the desktop app; no Rust HTTP server runs. The selected folder is tracked natively, and every file command validates both the workspace and the relative path.

## Historical implementation notes

The following notes describe earlier releases and prototypes. They are retained as development context, not as the current feature list.

### Feature baseline (v0.5)

- A compact navigation rail for **Home**, **Files**, and **Todos**. The file pane can be collapsed, and the document header stays compact.
- Home is the starting dashboard; Settings manages remembered folder shortcuts without deleting their files.
- Todos gathers tasks from all Markdown notes in the folder and its subfolders. Search, filter by open/completed/all, check off tasks, and jump to the source note.
- A native folder picker adds local folders and restores the last active folder on launch.
- Files uses the same spacing as Todos, with folders on the left, a persistent file list in the middle, and a viewer/editor on the right. `.md`, `.markdown`, `.pdf`, `.svg`, `.png`, `.jpg` and `.jpeg` are included, case-insensitively.
- Markdown notes are editable; PDFs, images, HTML, DOCX, PPTX, and TXT open read-only. PDFs have page navigation and zoom; PowerPoint has single-slide and grid views. HTML previews are isolated without scripts or external resources, and Office formatting may differ from the original application. Non-Markdown files are searchable by filename and path, while Markdown content is searchable too.
- **Visual** mode is the default: read and edit formatted Markdown directly with Milkdown/ProseMirror.
- A compact formatting toolbar handles headings, bold, italic, strike-through, links, lists, tasks, quotes, code, and tables. Undo/redo and Markdown typing shortcuts work here too.
- **Markdown** mode opens the source in CodeMirror 6, with syntax highlighting, undo/redo, line wrapping, and search within the note.
- Files are read and written directly on disk. Autosave runs after 650 ms of idle typing, with **Saved / Unsaved / Saving** status.
- Create new notes in the root or existing subfolders. Creating a note never overwrites an existing filename.
- Search filenames, relative paths, and content, with snippets for matches.
- A native filesystem watcher follows additions, renames, removals, and external edits. Refresh and returning to the app window also check for changes.
- An optional collapsible Markdown preview uses markdown-it. Icons are from Lucide.
- Notes are saved before switching note/folder or quitting normally, including through the native Quit menu action.
- External edit conflicts offer **Save a copy** and **Reload disk version**. Failed saves keep the draft in the editor.

### Early release limitations

- UTF-8 Markdown files up to **20 MiB**; read-only PDFs, images, HTML, DOCX, PPTX, and TXT up to **50 MiB**. Unreadable files are reported when opened; Markdown content search warns about skipped files. Password-protected PDFs or Office files may not open.
- The file tree does not follow symlinks. Symbolic file links cannot be opened; paths outside the workspace are rejected.
- `.git`, `node_modules`, `.obsidian`, and `.trash` are skipped during scans. Other hidden folders may appear.
- Content search scans on demand without a database or search index; very large folders or network volumes may be slower. Native watch support varies by filesystem; Refresh is available as a fallback.
- Creating new subfolders, renaming/deleting files, reMarkable sync, and multiple document tabs are outside this version.
- Preview handles headings, lists, code, quotes, and tables. Raw HTML is disabled. Links show text with the address in a tooltip; images appear as placeholders. External images are not loaded, and links do not navigate away from the editor.
- One app window and one open note at a time. Editor mode and preview visibility are remembered; the last open note is not.

### Earlier sync setup prototype

Development includes a **Sync setup** switch in a project's local folder header. Its dialog saves the local folder/subfolder and linked reMarkable destination in `project.json` (or legacy `projects.json`). Library folder references remain portable; external folder locations stay in the local registry. Subfolders inherit enabled setup, and overlapping setups are rejected. This is configuration only: it does not create cloud folders, transfer notes, or enable write-back. The packaged download does not include this development UI yet.
