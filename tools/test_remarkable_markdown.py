from io import BytesIO
import unittest
from rmscene import read_tree, read_blocks, write_blocks
from rmscene.scene_items import ParagraphStyle as Style
from rmscene.scene_stream import RootTextBlock
from rmscene.crdt_sequence import CrdtSequenceItem
from rmscene.tagged_block_common import CrdtId
from remarkable_markdown import encode_markdown, decode_markdown


class MarkdownTests(unittest.TestCase):
    def test_styles_are_native_and_markers_are_not_text(self):
        source = '# Titel\n\n## Subkop\n\n- punt\n- [ ] open\n- [x] klaar\n\nEen **vet** en *cursief* woord.\n'
        data = encode_markdown(source)
        tree = read_tree(BytesIO(data))
        self.assertEqual(decode_markdown(data), source)
        self.assertEqual(set(s.value for s in tree.root_text.styles.values()),
                         {Style.PLAIN, Style.HEADING, Style.BOLD, Style.BULLET, Style.CHECKBOX, Style.CHECKBOX_CHECKED})
        values = tree.root_text.items.values()
        visible = ''.join(v for v in values if isinstance(v, str))
        self.assertNotIn('#', visible)
        self.assertNotIn('*', visible)
        self.assertNotIn('[ ]', visible)
        self.assertTrue({1, 2, 3, 4}.issubset(set(v for v in values if isinstance(v, int))))
        codes = [item for item in tree.root_text.items.sequence_items() if isinstance(item.value, int)]
        self.assertTrue(all(item.item_id.part2 > len(visible) + 16 for item in codes))
        timestamps = [value.timestamp for value in tree.root_text.styles.values()]
        self.assertEqual(len(timestamps), len(set(timestamps)))

    def test_normalized_markdown_and_nested_inline_styles(self):
        for source in ['# café 🚗\n\n* __vet__ en _cursief_\n',
                       '***samen*** en **vet *ook schuin* vet**\n',
                       '## subkop\n\n  - ingesprongen\n',
                       'gewone \\*ster\\* en \\_underscore\\_\n', '', '\n\n', 'laatste zonder newline']:
            with self.subTest(source=source):
                normalized = decode_markdown(encode_markdown(source))
                self.assertEqual(decode_markdown(encode_markdown(normalized)), normalized)

    def test_unsupported_features_are_rejected(self):
        for source in ['### derde kop\n', '```python\nx\n```\n', '[link](https://example.com)',
                       '> citaat\n', '1. genummerd\n', '`code`', '- [ ] item\n  - [ ] nested', 'Titel\n=====\n']:
            with self.subTest(source=source):
                with self.assertRaises(ValueError):
                    encode_markdown(source)

    def test_native_edit_inherits_bold_and_returns_as_markdown(self):
        blocks = list(read_blocks(BytesIO(encode_markdown('**vet**\n'))))
        root = next(b for b in blocks if isinstance(b, RootTextBlock))
        # Insert inside the native bold run using a second tablet author ID.
        root.value.items.add(CrdtSequenceItem(CrdtId(2, 1000), CrdtId(1, 16), CrdtId(1, 17), 0, 'X'))
        output = BytesIO()
        write_blocks(output, blocks)
        self.assertEqual(decode_markdown(output.getvalue()), '**vXet**\n')


if __name__ == '__main__':
    unittest.main()
