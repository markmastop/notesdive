import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from rmscene import simple_text_document, write_blocks
from rmscene.crdt_sequence import CrdtSequence, CrdtSequenceItem
from rmscene.scene_stream import RootTextBlock
from rmscene.scene_items import ParagraphStyle
from rmscene.tagged_block_common import CrdtId, LwwValue

from remarkable_text_probe import decode, encode, probe


class TextProbeTests(unittest.TestCase):
    def test_markdown_and_unicode_round_trip(self):
        for text in ["", "one", "\n\n", "# Titel\n\n- [ ] café 🚗\n- [x] klaar\n\n**vet** en *cursief*\n", "CRLF\r\n\r\nend\r\n"]:
            with self.subTest(text=text):
                self.assertEqual(decode(encode(text)), text)

    def test_native_insertion_inside_run_and_deleted_character(self):
        blocks = list(simple_text_document("ABCD"))
        root = next(block for block in blocks if isinstance(block, RootTextBlock))
        end = CrdtId(0, 0)
        root.value.items = CrdtSequence([
            CrdtSequenceItem(CrdtId(1, 16), end, end, 0, "AB"),
            CrdtSequenceItem(CrdtId(1, 18), CrdtId(1, 17), CrdtId(1, 19), 1, ""),
            CrdtSequenceItem(CrdtId(1, 19), CrdtId(1, 18), end, 0, "D"),
            CrdtSequenceItem(CrdtId(2, 1), CrdtId(1, 16), CrdtId(1, 17), 0, "X"),
        ])
        output = BytesIO()
        write_blocks(output, blocks)
        self.assertEqual(decode(output.getvalue()), "AXBD")

    def test_probe_preserves_source_and_refuses_existing_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "original.md"
            source.write_bytes(b"# Original\n\n- [ ] task\n")
            original = source.read_bytes()
            destination = Path(directory) / "trial"
            report = probe(source, destination)
            self.assertTrue(report["bytesEqual"])
            self.assertFalse(report["tabletEditVerified"])
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual((destination / "Sync-proef-terug.md").read_bytes(), original)
            with self.assertRaises(FileExistsError):
                probe(source, destination)

    def test_native_formatting_is_rejected_without_silent_loss(self):
        for inline in [False, True]:
            with self.subTest(inline=inline):
                blocks = list(simple_text_document("Text"))
                root = next(block for block in blocks if isinstance(block, RootTextBlock))
                if inline:
                    root.value.items.add(CrdtSequenceItem(
                        CrdtId(2, 1), CrdtId(0, 0), CrdtId(1, 16), 0, 1,
                    ))
                else:
                    root.value.styles[CrdtId(0, 0)] = LwwValue(CrdtId(2, 1), ParagraphStyle.HEADING)
                output = BytesIO()
                write_blocks(output, blocks)
                with self.assertRaisesRegex(ValueError, "formatting"):
                    decode(output.getvalue())


if __name__ == "__main__":
    unittest.main()
