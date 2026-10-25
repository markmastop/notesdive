# NotesDive

A calm desktop app for local Markdown notes, built with **Tauri 2, React, TypeScript, and Vite**. Your folder is your workspace, and your `.md` files remain the source of truth. There is no backend server, account, cloud storage, database, or SQLite.

Your notes. Your files. Your space.

The desktop app lives directly in the repository root. Supporting documentation is in `docs/`, release packaging tools are in `scripts/`, and development probes are in `tools/`. Run npm commands from the repository root.

See the [roadmap](docs/roadmap.md), [supported task syntax](docs/supported-tags.md), and [release notes](docs/releases/v0.18.9.md). The roadmap records plans and their status at its stated date. Repository conventions are in [AGENTS.md](AGENTS.md).

## Get the source

```sh
git clone https://github.com/markmastop/notesdive.git
cd notesdive
```

NotesDive source code and compiled app are licensed under the [MIT License](LICENSE). The website source has been removed; the app uses public GitHub Releases for update checks.

## reMarkable cloud browser (0.10.0)

NotesDive 0.10.0 has a dedicated **reMarkable** navigation item beside Files and Todos. It uses the same folder/list/detail layout, search controls and spacing. The macOS Apple Silicon download includes this browser.

Choose **Get a pairing code**, sign in on reMarkable's website, and enter the eight-character one-time code in NotesDive. Once device registration succeeds, the device token is immediately stored in the operating system credential store (macOS Keychain, Windows Credential Manager or Linux Secret Service); it is never returned to the webview or written into a library, config JSON or Git repository. A failed cloud-session or library request leaves the registration saved, so **Refresh** retries with the same connection. The session-token POST explicitly sends an empty body with `Content-Length: 0`, matching Planmatic. Errors identify whether registration, session authentication, or library reading failed without exposing tokens or remote response bodies. Linux requires an available, unlocked Secret Service. **Disconnect** removes NotesDive's saved credential and in-memory listing; it does not change cloud documents or revoke the registration at reMarkable.

**My files** shows the cloud root. Browse the folder tree or open a folder in the middle column; empty folders are included. **All documents** lists notebooks throughout the library. Search matches names and folder paths across the library, and the Pinned filter and Name/Recent sorting refine the results. On narrower windows a folder selector replaces the folder sidebar. Selecting a document opens a read-only preview. Notebook v5/v6 pages render handwriting and typed text locally, with the same page controls and fit-width zoom as the existing PDF viewer. The focus button expands the reader; the information button shows type, page count, orientation and location. Imported PDFs open with the existing PDF viewer. EPUB books open in a shared reader with chapter navigation and text zoom; the same reader supports local `.epub` files.

Browsing reads the cloud root index, document indexes and metadata, with at most six simultaneous metadata requests. Selecting a document reads its `.content` metadata on demand. Browsing does not download `.rm` page bodies, PDFs or thumbnails, create project files, or maintain an on-disk document cache. Opening a notebook downloads only the selected page; switching pages fetches that page on demand. Opening a PDF downloads the original PDF into viewer memory. Native downloads are limited to 20 MiB per notebook page and 50 MiB per original PDF or EPUB. The HTTP connection pool, cloud session token, root hash and last complete listing are reused in memory. An unchanged library requires only a root-hash check; changed documents reuse their existing metadata when its file hash is unchanged. An expired session is renewed once automatically. During an initial scan, discovered folders and documents appear with a progress count, and folders can be browsed before the scan finishes. Document previews and details become available when the scan completes. Refresh retains the complete previous list until the new snapshot succeeds; a failure leaves it visible with an error and discards partial results. The cloud reflects changes only after the tablet uploads them. No offline browsing is promised after closing the app.

This release supports **browsing, read-only notebook/PDF/EPUB previews and PDF export**. Notebook paper templates are not included, and typed text layout and pen appearance may differ from the tablet. PDFs show the original imported file without reMarkable annotation layers. EPUB uses the book spine order and embeds local illustrations into inert, sandboxed chapters; chapter scripts, remote resources and protected/encrypted content are not supported. EPUB publisher layouts/fonts may be simplified. Project references, editing and write-back remain future work. Notebook rendering runs in a worker with a timeout so malformed pages cannot block browsing; errors offer a retry. Apart from token registration/refresh, the cloud integration makes only read requests. It uses the same unofficial cloud endpoints as the earlier Planmatic connector; changes to those endpoints or index schemas may require an update. Schema 3 and 4 indexes are supported, with invalid indexes rejected and trash descendants hidden.

Unit tests cover index parsing, folder visibility and search; browser tests use a mocked Tauri bridge for pairing, lazy detail loading, failed refresh recovery, progressive folder browsing, partial-scan failure recovery, disconnection, narrow layouts and the local-note save gate. Native HTTP fixture tests verify root-only refreshes, metadata reuse, session renewal, binary downloads, size limits, page order, blank pages and preservation of a complete snapshot after failure. Viewer tests use public v5/v6 fixtures and check lazy loading, real rendering, zoom, retries and stale response handling in Chromium and WebKit. Export tests inspect real PDFs for notebook page order, blank pages, vector text, EPUB chapter scope, unchanged original PDF bytes and failure/cancellation safety. A live account/device smoke test still requires pairing through the app.

## reMarkable PDF export (0.10.0)

Use **PDF** in the reMarkable document header. Notebooks offer **Whole document** or **Current page**; EPUB offers **Whole document** or **Current chapter**. Notebook export fetches missing pages on demand and preserves each notebook page, including blank pages, as one vector A4 PDF page. Typed text remains selectable. EPUB export reflows the selected chapters with the normal PDF typography. Original PDFs are saved without recompression or changes to their bytes. Single-page/chapter filenames include their source number.

Generated exports share the existing PDF footer, local date-based filename and **Save PDF** dialog. Progress and cancellation are available while preparing the document; an error or cancellation prevents a partial PDF from being saved. Notebook export is limited to 100 MiB of rendered SVG content. EPUB resources are read with an 8 MiB per-resource and 100 MiB book budget. Exports have the same template/annotation limitations as previews and do not upload changes to reMarkable.

## PDF export

Since version 0.18.2, choose **PDF** in the document header to export only the open document, in both Files and the project reader. Every viewer uses this location, including reMarkable, whose page/chapter scope and cancellation controls remain available. **Export PDF** in the workspace toolbar still exports workspace pages such as Todos when no document viewer is open.

The export is generated locally, then saved through **Save PDF**. The suggested filename replaces spaces with underscores and ends with the local export date in `yyyymmdd`, for example `Project_validation_20261002.pdf`. Markdown uses the current editor content, including unsaved edits. Markdown, Word, HTML, TXT and EPUB use readable, selectable text, bundled fonts, generous A4 margins, restrained headings, styled tables and links, and a subtle footer with the document name, generation date/time, time zone and page number. Tables with more than five columns use landscape A4. Todos includes every task matching the current filters, including collapsed groups. EPUB exports all chapters; local PDFs are saved unchanged, including all pages.

Marp and PowerPoint export every slide as a separate full-bleed PDF page with the original aspect ratio, independent of the current slide or grid view. Marp exports include the selected built-in or local/library theme, local background artwork, images, slide headers/footers and pagination; private speaker notes are omitted. Source-edit mode exports the same themed deck. A missing custom theme or theme artwork must be fixed before export, rather than silently substituting the default theme. Slides are embedded as high-resolution images, so their text is not selectable; complex CSS unsupported by html2canvas may differ from the preview. Slides do not receive the standard document footer. The raster canvas is bounded to 4096 pixels per side and the accumulated slide-image data to 100 MiB. Remote document resources are never fetched. No system print dialog or remote conversion service is used. Canceling the save dialog leaves files untouched.

## Update notice

The version at the top right opens a small update panel. On macOS Apple Silicon, the app checks the latest stable release through the GitHub API at `https://api.github.com/repos/markmastop/notesdive/releases/latest` at startup and when returning to the app, with automatic requests limited to once per 24 hours. The panel also has **Check for updates**, which bypasses that cache, and shows the last successful check. A newer stable release adds an **Update available** badge with **Download** and **What's new** actions. Those actions open the installer and release notes for that exact version on GitHub in the system browser; installation remains manual.

Checks request only public release metadata, without cookies, note content, or workspace paths. Offline checks never block editing or show a popup. A manual check reports connection failures, and a previously found update remains available. Other platforms do not make update requests until a compatible download is supported. The repository and installer filename are defined in `release-config.json`. Drafts, prereleases, malformed release metadata, and releases without a fully uploaded matching installer are rejected. GitHub access failures and rate limits report an unavailable check without claiming the app is up to date. The repository and releases must be public for anonymous checks; no GitHub token is included in the app.

## Libraries

Open **Settings** using the gear at the bottom of the navigation rail. Under **Libraries**, choose **New library**, enter a name, then select its parent folder with the native folder picker. NotesDive creates a new folder there; existing folders are never adopted or overwritten by this action. **Open library** opens an existing library folder containing `library.json`. Keep several libraries, such as Work and Personal, and switch between them with the Library selector. Each remembers its selected project. **View projects** returns to the project overview; library management stays in Settings. The active library name is shown in the Projects breadcrumb. **Remove from list** forgets the location without deleting library files; Open library can add it again.

Each new project gets a stable folder within its library:

```text
My library/
  library.json
  README.md
  .gitignore
  projects/
    project-name-<id>/
      project.json
      README.md
      Links.md
      notes/
      attachments/
```

Project names, descriptions, colors, pins, archives, folder references, and default destinations live in each `project.json`. These JSON files have a versioned format. Markdown notes and attachments remain ordinary files. `Links.md` provides a place for standard `[title](https://example.com)` references. In the project cockpit, click a link title to open the website in the default browser, use its separate pencil button to edit the source document, or copy its address. In a browser preview links use a new tab; the desktop follows the default browser’s tab/window preference. Only HTTP and HTTPS destinations can be opened. Audio recording and playback remain planned. New notes default to the project's own folder unless another default is chosen. Use a relative note name such as `notes/Meeting.md` to place one in its notes subfolder. Renaming a project changes its display name, leaving its stable folder name intact.

Folder references inside the library are relative to its root. Move or copy the entire library, then use Open library at the new location to recover the projects, including after reinstalling NotesDive or losing app settings. Externally attached folders remain in their original locations; the library contains only named references to them. Their absolute locations are stored locally, and must be reconnected on another computer. Copying the library does not copy those external notes. Opening a moved copy of the same library replaces its remembered location; create a new library for an independent collection.

Local `libraries.json`, beside `workspace.json` in the app config directory, stores remembered library locations, the active library/project, and external-folder bindings. It contains no note bodies. A library may live inside a Git repository; commit its Markdown and JSON files using your existing Git tools. Library operations do not initialize a repository, commit, push, synchronize, or store Git credentials. Empty `.gitkeep` files retain the `notes/` and `attachments/` directories when the library is committed to Git.

Older v0.8 projects remain accessible as **Older projects on this Mac**. In Settings, create or open a library and choose **Import older projects** to copy their setup into project folders. Existing note files and the original `projects.json` remain untouched, and repeated imports skip already imported project IDs. Imported external folders still require their own backup.

The app saves an open note before switching libraries. Unsaved project settings must be saved or cancelled first. Missing libraries remain listed; reconnect through Open library, switch to another library, or remove the shortcut. Use **Settings → Reload library** after changing project JSON outside NotesDive, including through Git. Stale saves are rejected, preserving the project-settings draft until you cancel or copy its changes and reload. Project metadata writes are atomic per file, but an interrupted multi-project import can complete partially; repeat the import to add remaining projects. NotesDive does not merge concurrent metadata changes or provide a backup service.

## Projects and Home

The **Projects** navigation button opens a collection of local projects. Create a project with a name, description, and color; attach existing folder shortcuts or choose more folders from disk. A folder can belong to several projects, and files stay in their original locations. Files and Todos continue to work with the active folder.

Since version 0.18.0, the project overview includes a stream of local documents, reMarkable notes, open tasks and links, sorted by the modification time of their source document. This is a current snapshot, not a historical audit log; tasks and links have no separate creation timestamps. Files and reMarkable have independent expandable folder trees, with selections retained while switching project tabs. Local content search keeps the complete folder tree visible. Local folder trees include empty subfolders; creation, rename and removal are picked up by the regular refresh without restarting the app. Results open in the existing editor or asset viewer alongside the project, and new notes can be created there. Tasks can be filtered by open, completed or all; toggles use the same revision checks and atomic saves as Todos. Continue working shows recent project documents, and documents and links can be pinned locally per library/project. RSS is not included.

In project Settings, change the name, description, color, attached folders, or default destination for new notes. Without a default, select a destination before creating a project note. Pin projects to sort them first, or archive and restore them. Detaching a folder, removing its shortcut in app Settings, and archiving a project never delete note files. A missing folder remains visible; **Reconnect folder** selects its replacement for this project only. Other available folders still load.

Projects in a library are saved in their own `project.json` files. Older projects without a library still use `projects.json` next to `workspace.json` in the app config directory. The app starts on Home; opening Projects selects the last project. Metadata includes local paths and contains no note bodies or account credentials.

When reMarkable is paired, Home also shows a shortcut to its cloud browser in the right column; the Home status check does not fetch the cloud library.

Home is a compact dashboard for all active projects: recently opened documents, pinned and recent projects with their descriptions, and open Markdown tasks from linked folders. Search finds documents by name or content and filters tasks and projects. Tasks can be completed there, and **New note** uses a selected project destination. Files shared by projects appear once. The active folder is included even when it is outside a project. Recent documents and project order are remembered locally in webview storage; removing a folder shortcut is managed in app Settings.

Project views refresh on focus, manually, and every 15 seconds while the window is visible. Changes in the individually active folder also trigger the existing native watcher. Markdown scans build task summaries in memory; large projects and slow network volumes may take time, and folders without an active watcher are not updated instantly. Project scans stop when leaving the view. Voice notes, remote connections, and portable project export remain on the roadmap.

## Features in v0.5

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

The source code and compiled NotesDive app are distributed under the [MIT License](LICENSE), which is bundled inside `NotesDive.app` and its release DMG. PDF.js and the Office viewers ship with [third-party notices](THIRD-PARTY-NOTICES.txt) and their license texts in the app bundle.

On an Apple Silicon Mac, prepare a local release package from the repository root with:

```sh
npm run release:mac
```

Before running it, update the version in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` together and write short notes in `docs/releases/v<version>.md`. The command builds the macOS app, verifies its signature and embedded licenses in the DMG, and copies the installer, release notes, and licenses into ignored `release/v<version>/` output. It does not publish a download or update the live website. See [GitHub release publishing](docs/github-releases.md) for the automatic tag workflow.

The macOS preview uses an ad-hoc signature and is not notarized, so macOS may show a Gatekeeper warning. A Windows or Linux download needs its own build and packaging before it can be advertised.

## Read and write visually

Open a note and start typing in **Visual** mode. Headings, bold text, lists, and tables are formatted in place; you do not need a separate preview. Select text to format it with the toolbar. Check off tasks directly. Table controls let you add rows and columns. Typing `# ` or `- ` at the start of a paragraph also creates a heading or list.

Switch to **Markdown** to edit the original source. Both modes use the same document state, autosave, and conflict detection. Merely opening, reading, or switching views does **not** rewrite the file. After an actual visual edit, Markdown syntax may be normalized, such as `*` replacing `-` for a list. The content remains Markdown; no HTML file is stored.

YAML or TOML front matter is preserved unchanged and can be edited in Markdown mode. Code blocks retain their language and additional information. Raw HTML is displayed as inert text. Images remain references and currently appear as placeholders. Footnotes do not have visual editing support yet; those notes remain readable and can be changed through **Edit Markdown**.

The chosen editor mode is remembered. A separate preview is available beside the Markdown source; Visual mode already renders formatted text in place.

## Document viewer

**Files** opens a three-column workspace with the same header, filters, and outer spacing as **Todos**. Folders are on the left, the file list is in the middle, and the viewer/editor is on the right. Each column scrolls independently. Choose **All files** or **Recent** (the latest 50 files within the folder filter). Folder counts include subfolders, and chevrons expand/collapse nested folders. Rows show filenames, relative paths, and modification dates. Sort by **Recent** or **Name**. Large lists initially show 60 files; **Show more files** loads 60 more at a time.

Search looks through names and paths for all supported files, and through content for Markdown. Markdown content matches show snippets. The open document remains visible on the right while searching or selecting a different folder, even if it no longer matches the list. Drafts remain visible and autosave continues. Opening another file first saves the Markdown draft; a failed save or conflict blocks the switch. PDF and image files are never modified by the viewer.

The viewer has Visual/Markdown controls, save status, a preview button, and a focus button. **Focus on document** hides both navigation columns without closing the editor; **Show notes and folders** brings them back. Closing the viewer saves first and preserves the list scroll position. New notes created from a selected folder start with that folder as the proposed path. Below 1100 px, a folder selector replaces the folder column so the list and viewer remain readable. Markdown preview appears below the source in the narrow viewer, or beside it in focus mode.

## Todos in larger workspaces

The Todo tab has its own document column with task counts per file. **All documents** shows up to three tasks per document; groups can be collapsed individually or together. **View all** opens one document's tasks. Long documents initially show 30 tasks and load another 30 on request. The document column and tasks scroll separately, so another document stays accessible even if the first contains hundreds of tasks. Search covers all documents within the current open/completed/all filter.

## Task index without a database

When a folder is opened or restored, NotesDive lists Markdown, PDF and image files. Only `.md` and `.markdown` files are read for the Todo index. The same exclusions and path checks used for the file tree apply. The index exists only in memory: per Markdown file it stores modification time, a SHA-256 revision, and task lines with positions. Full note contents are not kept in this index. There is no SQLite file, cache file, or extra server.

Tasks are Markdown list items with `- [ ]`, `- [x]`, or `- [X]`; nested and numbered tasks are also recognized. New task properties use Dataview-style inline fields, for example `- [ ] Send report [assignee:: @alex] [start:: 2026-10-02] [due:: 2026-10-05] [priority:: high] [stage:: doing] #work`. Dates use `YYYY-MM-DD`; priorities are `urgent`, `high`, `normal`, `medium`, or `low` (`medium` sorts like `normal`); stages are `backlog`, `todo`, `doing`, `review`, `blocked`, or `done`. One `@name` assignee is supported. A checked task displays effective stage `done`, while its written stage is retained. Older `due:`, `start:`, and `priority:high|medium|low` fields remain readable. The Todo tab shows metadata badges, filters by due date (overdue, today, upcoming, or undated), and sorts by due date or priority. Home and Projects show the same badges and bring earlier deadlines forward. Invalid dates, unknown values, and unrecognized fields remain ordinary task text. A Markdown parser distinguishes real tasks from examples in code blocks, HTML blocks, and YAML/TOML front matter. An isolated word such as “TODO” does not count as a task. These fields are available in the current download; see [supported task syntax](docs/supported-tags.md) for release availability. Kanban controls are planned; `stage` currently appears as a label.

The native watcher reports changed paths. After a short event batch, the index rereads only new, changed, or explicitly reported files. Deleted files disappear; directory changes also check nested notes. A successful editor save refreshes its file immediately. **Refresh** and returning to the window perform a full check if a filesystem watch event was missed. Scans run sequentially, and stale scans stop when the workspace changes. Unreadable files are reported individually.

Checking off a task in **Todos** rereads the file and verifies its revision. Only the character inside the brackets is changed; the remaining Markdown, BOM, and line endings are preserved exactly. The native save verifies the revision again before an atomic write. Stale tasks are not overwritten: the list refreshes and asks you to retry. Switching tabs first saves any editor draft; if saving fails, the draft stays open.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Save | ⌘ S | Ctrl S |
| New note | ⌘ N | Ctrl N |
| Search all notes | ⌘ Shift F | Ctrl Shift F |
| Search current note (Markdown mode) | ⌘ F | Ctrl F |
| Toggle preview | ⌘ Shift P | Ctrl Shift P |
| Undo / redo | ⌘ Z / ⌘ Shift Z | Ctrl Z / Ctrl Shift Z |

## Storage and conflicts

### Opening Markdown from Finder (development)

The next macOS build registers NotesDive as an editor for `.md` and `.markdown`.
Use Finder → **Open With → NotesDive** to open a file, including files outside
your library. To make double-click use NotesDive, select a Markdown file,
choose **Get Info → Open with → NotesDive → Change All**. The current installed
app and published download need to be replaced with a build containing this change.

Finder opens use the existing editor and save directly to the original file.
If the file is inside the active notes folder, that folder stays active;
otherwise its parent becomes a remembered local notes folder. No library or
project is created and the file is not copied. Startup requests wait for the
editor to restore; requests received while the app is running use the same
save gate as ordinary navigation. Failed saves keep the current draft open.
Only one note is open at a time, so selecting multiple files opens them in
sequence and leaves the last one visible. Existing UTF-8, size, symlink and
conflict checks also apply to files opened from Finder.

The app stores the remembered folder paths and active path in `workspace.json` in the platform-specific app config directory (`app.notesdive.desktop`). Existing single-folder settings are migrated automatically. On macOS this is under `~/Library/Application Support/`; on Windows under `%APPDATA%`; on Linux under `$XDG_CONFIG_HOME` or `~/.config`. Only the active folder is watched and indexed; switching refreshes its notes and tasks. Removing a folder shortcut in Settings leaves its files on disk. Editor mode and preview preference live in local webview storage. Note content remains in your Markdown files.

Native saves are serialized. The on-disk revision is checked with SHA-256 before saving and again immediately before replacement. A temporary file in the same directory then atomically replaces the original. A failed write is never marked Saved. File permissions are retained; CRLF and an existing UTF-8 BOM are preserved while editing. Other file metadata, such as extended attributes, is not explicitly copied.

If another app changes a clean note, NotesDive reloads it. If a draft is unsaved, autosave pauses. Choose **Save a copy** to keep both versions, or **Reload disk version** to replace the draft after confirmation. The same recovery options apply when an open file is moved or deleted.

This protects against ordinary concurrent edits but is not a shared file lock with other programs: an external writer may still write in the short interval between the final check and replacement. Forced quit, a crash, or power loss before autosave can lose unsaved text. This version has no crash recovery or version history.

## Current limits

- UTF-8 Markdown files up to **20 MiB**; read-only PDFs, images, HTML, DOCX, PPTX, and TXT up to **50 MiB**. Unreadable files are reported when opened; Markdown content search warns about skipped files. Password-protected PDFs or Office files may not open.
- The file tree does not follow symlinks. Symbolic file links cannot be opened; paths outside the workspace are rejected.
- `.git`, `node_modules`, `.obsidian`, and `.trash` are skipped during scans. Other hidden folders may appear.
- Content search scans on demand without a database or search index; very large folders or network volumes may be slower. Native watch support varies by filesystem; Refresh is available as a fallback.
- Creating new subfolders, renaming/deleting files, reMarkable sync, and multiple document tabs are outside this version.
- Preview handles headings, lists, code, quotes, and tables. Raw HTML is disabled. Links show text with the address in a tooltip; images appear as placeholders. External images are not loaded, and links do not navigate away from the editor.
- One app window and one open note at a time. Editor mode and preview visibility are remembered; the last open note is not.

## Tests

Development includes a **Sync setup** switch in a project's local folder header. Its dialog saves the local folder/subfolder and linked reMarkable destination in `project.json` (or legacy `projects.json`). Library folder references remain portable; external folder locations stay in the local registry. Subfolders inherit enabled setup, and overlapping setups are rejected. This is configuration only: it does not create cloud folders, transfer notes, or enable write-back. The packaged download does not include this development UI yet.

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

### Clipboard images

Paste a copied PNG or JPEG screenshot with Cmd+V (Ctrl+V on Windows/Linux) in either the visual or Markdown editor. NotesDive saves new clipboard images directly in the same folder as the note and inserts a relative Markdown image reference. Existing references to images in `attachments` folders remain supported. Images remain local and support undo/redo in the editor. Clipboard images are limited to 50 MiB. Manual reMarkable sync does not transfer these images.

### Marp presentations

Markdown with `marp: true` uses the official Marp engine in NotesDive 0.15.0 and later.
The viewer supports the `default`, `gaia` and `uncover` themes, 16:9 and 4:3,
`class`/`_class`, colors, headers, footers, pagination and `style:` CSS. HTML
comments containing ordinary text become per-slide **Notes**; directive comments
configure the slide. The slide grid marks slides containing notes.

**View slide** and **Slide grid** are for reviewing the deck; **Edit Markdown**
edits its source. The separate **Present fullscreen** button presents the current
slide across the desktop window with app chrome and speaker notes hidden. Use
Left/Right, Page Up/Down or Space (Shift+Space for previous), Home and End to
navigate. Move the pointer to reveal navigation and exit controls. Escape or
**Exit presentation** returns to the viewer on the current slide and restores the
window's previous fullscreen state.

Libraries have a portable `themes/` folder. Settings → Libraries → **Themes**
lists custom CSS files and can create this folder for older libraries. New
libraries include the folder automatically. A file named `workshop.css` must
contain `/* @theme workshop */`; use `theme: workshop` in a presentation. Click
**Reload presentation theme** after changing its CSS. Theme names use letters,
numbers, dashes and underscores. Local themes beside a presentation in `themes/`
and the open note folder's `themes/` take precedence over the selected library's
shared themes. Missing themes show an explanation and use the default styling.

For a starter theme and presentation, see [the Marp example](examples/marp/Workshop.md).
Copy its `themes/notesdive.css` into your library's `themes/` to reuse it across
projects. Themes may inherit a built-in theme with `@import "default"`,
`@import "gaia"` or `@import "uncover"`.

Themes can include a companion image folder: for example, `themes/demo.css`
may refer to `url("demo/cover.png")` in `themes/demo/cover.png`. Keep both
when copying a theme. PNG, JPEG and SVG references resolve relative to the CSS
file through scoped local readers. They must stay inside that `themes/` folder.
The loader supports up to 32 distinct images and 32 MiB of encoded image data;
missing or oversized images show a warning. Reloading a theme reloads its images.

Slide CSS is isolated from the application. Remote images, fonts and stylesheet
imports are not fetched. Inline Markdown images and ordinary slide background
images resolve through the existing workspace-scoped local image reader. Theme
files are read-only UTF-8 CSS, limited to 16 MiB. Math/diagram plugins, SVG-based
fitting headings, and advanced split/multiple-image backgrounds are not enabled;
ordinary background images work. The native HTML renderer avoids WebKit's SVG
painting and pointer-coordinate mismatch.

### Home cockpit (0.16.0)

Home shows an attention strip for overdue, due-today and blocked open tasks,
above **Streams**, **My focus** and **Continue working**. Focus ranks due/overdue actions first,
then urgent, high-priority and in-progress actions. Attention buttons narrow the
focus list. Task completion uses the existing conflict-safe Markdown writer;
reMarkable tasks remain read-only and include only pages already read.

Streams combine open actions with recently changed documents. **This week** uses
local Monday-to-Sunday boundaries, task start/due dates and document modification
times. Project streams filter both kinds of work. **Add stream** saves a named
project and/or exact task-tag filter on this device, separately for each library.
Tags currently filter tasks only; document content is not indexed for tags.
Saved streams can be removed from their selected view. Home search also applies
to stream results. Streams occupy the wide left column, focus actions the middle column, and recent
documents and project shortcuts the right column. Streams have All, Documents
and Actions filters and show each item with its type and project. The Home header and attention strip stay visible while each column scrolls
independently. On smaller windows, streams stay on the left with focus and recent
work stacked on the right; on narrow windows the three scroll areas stack with
streams first. Scroll areas also support keyboard navigation. RSS remains future work.
