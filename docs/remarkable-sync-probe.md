# Manual reMarkable Markdown probe

These developer probes predate the integrated [manual folder sync](remarkable-folder-sync.md). The folder switch saves configuration; the app’s Sync now button performs transfers. The developer tools here perform
manual conversion, create-only upload and fetch; they are not integrated into
automatic app synchronization.

## Setup and use

Use an isolated Python environment with `tools/requirements-remarkable-probe.txt`:

```sh
python -m pip install -r tools/requirements-remarkable-probe.txt
python -B -m unittest discover -s tools -p 'test_remarkable*.py'
python -B tools/remarkable_cloud_probe.py prepare /absolute/path/Sync-proef.md /absolute/path/project.json /absolute/path/new-probe-directory
python -B tools/remarkable_cloud_probe.py upload /absolute/path/new-probe-directory
python -B tools/remarkable_cloud_probe.py fetch /absolute/path/new-probe-directory /absolute/path/new-return-directory
```

Only upload after the user authorizes the note and linked destination. macOS and
an existing NotesDive credential in Keychain are required. Credentials stay in
memory and never appear in the manifest or command output. Requests use fixed
reMarkable hosts, TLS verification, bounded responses and no redirects.

Preparation saves stable document/page IDs, a `.rmdoc` notebook package, file
hashes and the canonical returned Markdown hash. Upload validates the linked
folder, adds one UUID while preserving existing index entries, and uses a
generation-checked root update. Concurrent changes abort the update. This tool
never deletes or overwrites a cloud document. After an uncertain result, retry
using the **same manifest**; an existing document ID causes no additional upload.
Do not prepare a new manifest to retry the same document.

## Native formatting

`remarkable_markdown.py` converts this supported subset to native typed text:

- ATX `#` headings to Heading and `##` headings to the native bold subheading.
- Unordered lists, including one indented level, to native bullets.
- `- [ ]` and `- [x]` tasks to native unchecked/checked boxes.
- Inline bold and italic, including nested combinations, to native format codes.

Markdown markers are removed from displayed text. Unsupported features such as
heading levels 3–6, code, links, quotes, numbered lists and setext headings are
rejected rather than silently flattened. This is not a general Markdown renderer.

Export restores native styles as Markdown. Bullet markers and emphasis syntax
are canonicalized (for example `* item` becomes `- item`), so rich conversion is
not a byte-for-byte source round trip. `sameAsPreparedMarkdown` compares the
returned canonical Markdown rather than the original source syntax.

The encoder writes ordinary text as a native CRDT insertion run and applies
inline styles as later operations anchored between existing characters. Format
operation clocks follow the text clocks, and paragraph assignments have distinct
timestamps. Local decode success alone is insufficient: early prototypes decoded
but rendered blank or omitted inline styles in the native app.

Fetch saves returned Markdown and the original `.rm` scene in a new directory;
the source note is never overwritten. Source-text trial notes that were formatted
manually are also exported, retaining their existing Markdown punctuation. The
raw scene is saved even if extraction fails, retaining handwriting data without
claiming to produce a rendered handwriting attachment.

## Verification and remaining work

A manual sync trial was uploaded and displayed in the official
reMarkable desktop app with headings, bullets, checkboxes, bold and italic. A
user-made text/format edit in the earlier trial was recovered as Markdown, and
its text was included in the corrected rich trial. The corrected cloud return
matched the prepared canonical Markdown.

The live experiment also exposed a critical update limitation: replacing a page
with regenerated author identities can merge into duplicate text on connected
clients. Keep automatic updates disabled until edits preserve CRDT identities
and are tested across device/cloud/client merges. The create-only CLI deliberately
does not expose a page replacement command.

The app now has a separate manual sync implementation; see [folder sync](remarkable-folder-sync.md). The create-only CLI remains unchanged.

Earlier probe acceptance work included app integration, project document-ID state,
physical-tablet edits of the rich trial, handwriting attachment export (including
text anchors), conflict copies, and atomic local saves. Some newer native blocks
are not fully understood by the pinned reader; always retain the untouched raw
scene and never rewrite a downloaded user notebook through this parser.

For the earlier byte-preserving source-text boundary test, use
`remarkable_text_probe.py probe SOURCE NEW_DIRECTORY`. Pass `--source-text` to
cloud preparation only when deliberately testing visible Markdown source. The
stock `rmc 0.3.0` exporter drops paragraph separators and adds a Highlights section;
it is unsuitable for lossless source-text sync without adaptation.

References: [rmscene](https://github.com/ricklupton/rmscene),
[rmc](https://github.com/ricklupton/rmc), and
[rmapi protocol reference](https://github.com/ddvk/rmapi).
