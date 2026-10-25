# Manual reMarkable folder sync

Enable Sync in a project folder's file-list header. This saves the setup without
transferring files. Open its sync icon in the folder tree or file-list header and choose **Sync now** to transfer changes.
The published reMarkable twin shows the same clickable sync icon and opens
the same setup. Cloud folder identities, rather than names, determine the twin.
Pausing the setup removes both indicators. Save or close an open note first. The first transfer creates a corresponding
folder beneath the project's linked reMarkable destination, including subfolders,
even when there are no Markdown notes. PDFs are uploaded; images are not uploaded.
Sync never deletes files or folders on either side. A pre-commit guard requires
every existing cloud root entry to remain present.

The app supports Markdown heading levels 1–2, bold, italic, bullets (including
one indent level), and checkbox tasks. Unsupported syntax is reported and skipped
rather than silently flattened. The original one-page notebook can be edited in
both directions. New notebooks created independently on the tablet, additional
pages, moves, and deletions are not imported or mirrored in this first version.
PDF originals are uploaded under the same folder, with up to 300 readable pages
and 16 MiB per PDF, within the 64 MiB run budget. Invalid/encrypted/oversized PDFs
are reported and skipped. A changed local PDF creates a new cloud document version:
the previous annotated document remains intact. A changed cloud PDF original is
saved as a separate `.remarkable-copy-<hash>.pdf` beside the local original, never
replacing it or an edited copy. Generated copies are excluded from uploads.
PDF handwriting, page content and the scene index are backed up under
`.notesdive-sync/<setup-id>/` and reported as native `.rm` attachments. A rendered
PDF containing tablet annotations is not implemented yet. New independent tablet
PDFs are not imported. No PDF file, page, or cloud document is deleted by sync.

Each setup stores a portable `state` object in the project JSON: folder IDs,
relative note paths, document/page IDs, local text hashes, remote page hashes,
published folder IDs and last completed run time. IDs are saved before cloud
mutation so an interrupted run can reuse them. Identical canonical text establishes
an unchanged baseline even after an uncertain commit; differing concurrent edits
produce a sibling `.remarkable-conflict-<hash>.md` copy of the tablet version. The
local note and notebook remain unchanged on a conflict. Repeated runs reuse an
identical conflict copy; a copy you have edited is never overwritten. Review and combine the
copy into the original before syncing again. Conflict copies are excluded from
uploads; they remain readable in the normal note list.

The backend bounds the chosen project scope, rejects symlink paths, verifies
cloud checksums for both index schemas, retains unrelated root entries and
notebook files, and checks the root generation before committing. Notes are limited
to 20,000 UTF-16 units; a folder is limited to 500 notes, 32 MiB of local
Markdown and 64 MiB including downloaded scenes. Local writes
check the original revision and replace files atomically. Raw notebook pages and
local versions before downloads are saved under `.notesdive-sync/<setup-id>/`.
This backup directory is hidden from note/task indexing. Handwriting is preserved
as native `.rm` data, not yet exported as a rendered PDF attachment. Changes to
text anchors can affect stroke placement; original raw pages remain available.

The app's TypeScript v6 codec retains existing author identities and text IDs,
uses tombstones for deletions and anchored insertion operations, and reuses one
writer identity per mapped notebook. Paragraph assignments and inline formatting
receive increasing logical timestamps. Non-text scene blocks and unknown blocks
are retained byte-for-byte; only authors, typed text and page text counts change.
The app does not invoke Python, the probe venv, or an external runtime.

Automated checks cover rich-text round trips, repeated edits, Unicode, unknown
scene retention, one-sided changes, conflict decisions, interrupted commit
recovery, index checksums, atomic copies, portable project journals and UI results
in Chromium/WebKit. The live development acceptance uses a test note in a local project, with the first create, unchanged repeat, native-client edits and
existing-page updates. The native client checkbox change was pulled into Markdown,
then restored locally and uploaded to the same notebook ID. A separate cloud
read confirmed the original Markdown and a single document. This is a development feature; no installer release or
website deployment is included.

Protocol references: [rmscene](https://github.com/ricklupton/rmscene),
[rmapi](https://github.com/ddvk/rmapi), and the already bundled
[remarkable-rm](https://github.com/Scratchydisk/remarkable-rm) display parser.
