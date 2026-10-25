# Your files first. A fuller workflow next.

NotesDive is a local-first workspace for notes, documents and projects. Your folders and ordinary Markdown files stay at the center. reMarkable is an optional connection that brings handwritten work into the same project view.

**Roadmap · Updated October 6, 2026**

“Available today” describes the current v0.15.0 release. “Next”, “Planned” and “Exploring” describe future work, not features you can use yet or a promised release date.

## Available today

- Read and edit local `.md` and `.markdown` notes, with autosave, search and a formatted editor. Work offline without a NotesDive account.
- Paste PNG and JPEG screenshots into Markdown notes; images are stored directly in the same folder as the Markdown note. Convert existing numbered and bullet lists using the editor toolbar. Selected folders show and count only their direct files.
- View local PDF, EPUB, Word, PowerPoint, HTML, text and image files. HTML links open related local documents and page sections; website links open in your browser.
- Write Marp presentations in Markdown. Review slides and speaker notes, use built-in or local CSS themes with companion artwork, and present fullscreen with keyboard navigation. Shared themes live in the library’s `themes/` folder.
- Create notes, tasks and links directly from the project overview widgets.
- Collect Markdown checkbox tasks across folders and update the original file when you complete a task.
- Organize several local folders in a project without moving their files. Project pages show that project's documents, tasks and links; the general views show all registered sources. A colored project tab makes the current context visible.
- Keep project organization in a portable library folder you choose. Reopen the library after moving it or reinstalling the app; external folders can be reconnected separately.
- Optionally connect reMarkable, attach its folders to a project, and read supported notebooks, PDFs and EPUB books alongside local files. Typed checkbox tasks can appear in the project task view. Export supported documents to PDF.

The reMarkable connection uses reMarkable's online service and needs internet. Local notes and documents remain usable independently.

## Manual reMarkable folder sync

**Available today · Early workflow**

Enable Sync on a local project folder and choose its reMarkable parent folder. Use **Sync now**, or the sync icon beside either folder twin, to transfer files deliberately. Enabling the switch alone does not transfer files.

- Send supported Markdown as editable native notebooks and bring typed edits back to local Markdown. Headings at levels 1–2, bold, italic, bullets and checkboxes are supported.
- Upload local PDFs for reading and annotation. Changed local PDFs create new versions, preserving previous annotated copies. PDF handwriting is kept as local `.rm` attachments.
- Preserve both versions when supported edits conflict. Never mirror deletions between the local folder and reMarkable.

Only the original single-page notebooks created through this sync are updated. Unsupported Markdown, images and other assets are skipped. New tablet notebooks and extra pages are not automatically imported. PDF uploads support up to 16 MiB and 300 pages per document, with a 64 MiB transfer budget per run. Keep NotesDive open until the transfer finishes.

**Planned:** explicit imports of existing tablet notebooks, support for more text styles and page layouts, rendered PDFs with handwriting annotations, and background synchronization after the manual workflow has been tested further. **Exploring:** handwriting recognition. There is no handwriting-to-text conversion in the current download.

## More tools for local projects

**Planned**

- Create folders and rename files with clear handling of links to renamed documents.
- Pin useful documents and links to the project overview.
- Add task metadata editing and a Kanban view using the same Markdown checkboxes and inline fields.
- Improve document previews, including reMarkable notebook templates and imported PDF annotation layers.
- Make local backup and recovery easier, while keeping libraries and notes readable outside NotesDive.

## Voice notes in your own files

**Planned**

Record or import audio into a project's chosen attachments folder, with a linked Markdown note for context. Start with recording, pause, playback and recovery after an interrupted recording. Request microphone access when recording is first used.

**Exploring:** local transcription, language selection and timestamps. The original audio remains in your files.

## Local history

**Planned**

Connect an existing local Git repository, review changes, and save a deliberate snapshot of selected notes. A project may span several repositories; each snapshot belongs to its own repository. Backups and remote publication remain explicit choices, separate from local editing.

## Settings and portability

**Available foundations · More preferences planned**

Library switching, project folder links, default destinations and folder shortcuts are available. Appearance, startup, editor, recording and future synchronization preferences follow their corresponding features.

Your files remain yours. Projects organize them without requiring a NotesDive account. Local reading and writing stay available offline. Optional connections never replace your local workspace, and imports and transfers remain visible choices.

As features ship, their actual behavior and limitations appear in the [release notes](releases/v0.18.9.md).
