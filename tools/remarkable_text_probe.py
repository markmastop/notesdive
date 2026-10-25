"""Developer-only, local Markdown-source / reMarkable v6 text probe.

Requires rmscene==0.6.1. This is not a cloud sync client or notebook package.
Markdown punctuation is deliberately kept as editable plain text.
"""

import argparse
import hashlib
import json
from pathlib import Path

from rmscene import read_tree, simple_text_document, write_blocks
from rmscene.crdt_sequence import CrdtSequence
from rmscene.scene_items import ParagraphStyle
from rmscene.text import expand_text_items


def encode(text: str) -> bytes:
    from io import BytesIO

    output = BytesIO()
    write_blocks(output, simple_text_document(text))
    return output.getvalue()


def decode(data: bytes) -> str:
    from io import BytesIO

    tree = read_tree(BytesIO(data))
    if tree.root_text is None:
        raise ValueError("No typed root text found; handwriting is not Markdown.")
    if any(style.value != ParagraphStyle.PLAIN for style in tree.root_text.styles.values()):
        raise ValueError("Native paragraph formatting is not supported by this source-text probe.")
    # Expand BEFORE ordering: tablet edits can refer to an implicit character ID
    # inside a string run. Ignore tombstones, never concatenate deleted text.
    sequence = CrdtSequence(expand_text_items(tree.root_text.items.sequence_items()))
    result = []
    for item_id in sequence:
        value = sequence[item_id]
        if not isinstance(value, str):
            raise ValueError("Native inline formatting is not supported by this source-text probe.")
        result.append(value)
    return "".join(result)


def write_new(path: Path, data: bytes) -> None:
    # Do not replace a source note or a previous probe artifact.
    with path.open("xb") as output:
        output.write(data)


def probe(source: Path, destination: Path) -> dict:
    original = source.read_bytes()
    text = original.decode("utf-8")
    encoded = encode(text)
    returned = decode(encoded).encode("utf-8")
    if returned != original:
        raise ValueError("Round trip changed the source; no artifacts were saved.")
    destination.mkdir(parents=True, exist_ok=False)
    write_new(destination / "Sync-proef.rm", encoded)
    write_new(destination / "Sync-proef-terug.md", returned)
    report = {
        "mode": "local-markdown-source-text",
        "source": str(source.resolve()),
        "sourceSha256": hashlib.sha256(original).hexdigest(),
        "returnedSha256": hashlib.sha256(returned).hexdigest(),
        "bytesEqual": True,
        "sourceBytes": len(original),
        "rmBytes": len(encoded),
        "converter": "rmscene 0.6.1",
        "tabletEditVerified": False,
        "cloudUploadPerformed": False,
        "handwritingAttachmentVerified": False,
        "limitations": [
            "Markdown syntax remains visible as plain typed text.",
            "Native heading/bold/italic formatting is rejected on return.",
            "A page .rm is not a complete tablet notebook package.",
            "No device edits, handwriting or cloud transfers were tested.",
        ],
    }
    write_new(destination / "result.json", (json.dumps(report, indent=2) + "\n").encode())
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    trial = sub.add_parser("probe")
    trial.add_argument("source", type=Path)
    trial.add_argument("destination", type=Path)
    export = sub.add_parser("export")
    export.add_argument("source", type=Path)
    export.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "probe":
        print(json.dumps(probe(args.source, args.destination), indent=2))
    else:
        write_new(args.destination, decode(args.source.read_bytes()).encode("utf-8"))


if __name__ == "__main__":
    main()
