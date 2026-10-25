"""Native reMarkable headings, bullets, checkboxes and bold/italic text.

Deliberately limited Markdown subset, not a general document renderer.
"""
from io import BytesIO
import re
from uuid import uuid4

from markdown_it import MarkdownIt
from rmscene import read_tree, simple_text_document, write_blocks
from rmscene.crdt_sequence import CrdtSequence, CrdtSequenceItem
from rmscene.scene_items import ParagraphStyle as Style
from rmscene.scene_stream import RootTextBlock, PageInfoBlock, AuthorIdsBlock
from rmscene.tagged_block_common import CrdtId, LwwValue
from rmscene.text import expand_text_items

MD = MarkdownIt('commonmark')
PREFIXES = {
    Style.BASIC: '', Style.PLAIN: '', Style.HEADING: '# ', Style.BOLD: '## ',
    Style.BULLET: '- ', Style.BULLET2: '  - ',
    Style.CHECKBOX: '- [ ] ', Style.CHECKBOX_CHECKED: '- [x] ',
}


def paragraph(line):
    heading = re.match(r'^(#{1,6})\s+(.*)$', line)
    if heading:
        if len(heading[1]) > 2:
            raise ValueError('Only heading levels 1 and 2 have native equivalents')
        return Style.HEADING if len(heading[1]) == 1 else Style.BOLD, re.sub(r'\s+#+\s*$', '', heading[2])
    bullet = re.match(r'^( {0,2})[-*+]\s+(.*)$', line)
    if bullet:
        check = re.match(r'^\[([ xX])\]\s+(.*)$', bullet[2])
        if check:
            if bullet[1]:
                raise ValueError('Nested checkboxes are not supported')
            return Style.CHECKBOX if check[1] == ' ' else Style.CHECKBOX_CHECKED, check[2]
        return Style.BULLET2 if bullet[1] else Style.BULLET, bullet[2]
    return Style.PLAIN, line


def inline_values(text):
    values = []
    bold = italic = 0
    for token in MD.parseInline(text)[0].children or []:
        if token.type == 'text':
            values.extend(token.content)
        elif token.type in ('strong_open', 'strong_close'):
            bold += 1 if token.type == 'strong_open' else -1
            values.append(1 if bold else 2)
        elif token.type in ('em_open', 'em_close'):
            italic += 1 if token.type == 'em_open' else -1
            values.append(3 if italic else 4)
        else:
            raise ValueError('Unsupported Markdown inline feature: ' + token.type)
    return values


def encode_markdown(text, author_uuids=None):
    # Validate block syntax first: never flatten tables/code/quotes/links silently.
    allowed = {'heading_open', 'heading_close', 'paragraph_open', 'paragraph_close',
               'inline', 'bullet_list_open', 'bullet_list_close', 'list_item_open', 'list_item_close'}
    for token in MD.parse(text):
        if token.type not in allowed:
            raise ValueError('Unsupported Markdown block feature: ' + token.type)
        if token.type == 'heading_open' and not token.markup.startswith('#'):
            raise ValueError('Setext headings are not supported by this probe')
    text = text.replace('\r\n', '\n')
    values, styles = [], {}
    start_id = CrdtId(0, 0)
    for line in text.split('\n'):
        style, body = paragraph(line)
        styles[start_id] = LwwValue(CrdtId(1, 15), style)
        values.extend(inline_values(body))
        # Character IDs are explicit, including inline format codes/newlines.
        start_id = CrdtId(1, 16 + len(values))
        values.append('\n')
    values.pop()  # split() retains the trailing empty paragraph if source ends LF.
    blocks = list(simple_text_document(''))
    root = next(b for b in blocks if isinstance(b, RootTextBlock))
    end = CrdtId(0, 0)
    # First insert plain text. Apply formatting as later operations anchored
    # between existing characters, like native device-generated files. Format
    # codes must not become character IDs in the original text insertion run.
    plain = ''.join(v for v in values if isinstance(v, str))
    items = [CrdtSequenceItem(CrdtId(1, 16), end, end, 0, plain)] if plain else []
    position = 0
    char_ids = {}
    for offset, value in enumerate(values):
        if isinstance(value, str):
            char_ids[CrdtId(1, 16 + offset)] = CrdtId(1, 16 + position)
            position += 1
    # Native inline-style operations must follow the inserted text in logical
    # time, even when a separate author ID is used.
    position, operation, previous_format = 0, 16 + len(plain) + len(styles), None
    for value in values:
        if isinstance(value, str):
            position += 1
            previous_format = None
        else:
            left = previous_format or (CrdtId(1, 15 + position) if position else end)
            right = CrdtId(1, 16 + position) if position < len(plain) else end
            item_id = CrdtId(2, operation)
            items.append(CrdtSequenceItem(item_id, left, right, 0, value))
            previous_format = item_id
            operation += 1
    root.value.items = CrdtSequence(items)
    # Each style assignment needs a distinct operation timestamp.
    root.value.styles = {char_ids.get(key, key): LwwValue(CrdtId(1, 16 + len(plain) + i), value.value)
                         for i, (key, value) in enumerate(styles.items())}
    authors = next(b for b in blocks if isinstance(b, AuthorIdsBlock))
    authors.author_uuids = author_uuids or {1: authors.author_uuids[1], 2: uuid4()}
    info = next(b for b in blocks if isinstance(b, PageInfoBlock))
    info.text_chars_count = sum(isinstance(v, str) for v in values) + 1
    info.text_lines_count = text.count('\n') + 1
    output = BytesIO()
    write_blocks(output, blocks)
    return output.getvalue()


def render_spans(spans, escape):
    # Re-open both marks in canonical nesting order when formatting changes.
    output, active = [], ()
    for text, bold, italic in spans:
        desired = tuple(m for m, enabled in [('**', bold), ('*', italic)] if enabled)
        if desired != active:
            output.extend(reversed(active))
            output.extend(desired)
            active = desired
        if escape:
            text = re.sub(r'([\\*_`\[\]])', r'\\\1', text)
        output.append(text)
    output.extend(reversed(active))
    return ''.join(output)


def decode_markdown(data, escape=True):
    tree = read_tree(BytesIO(data))
    if tree.root_text is None:
        raise ValueError('No typed root text found')
    seq = CrdtSequence(expand_text_items(tree.root_text.items.sequence_items()))
    start = CrdtId(0, 0)
    bold = italic = False
    lines, spans = [], []

    def finish():
        style = tree.root_text.styles.get(start)
        style = style.value if style else Style.PLAIN
        if style not in PREFIXES:
            raise ValueError('Unsupported native paragraph style')
        body = render_spans(spans, escape)
        if escape and style in (Style.PLAIN, Style.BASIC) and re.match(r'^(#{1,6}\s|[-+]\s|\d+[.)]\s|>)', body):
            body = '\\' + body
        lines.append(PREFIXES[style] + body)

    for item_id in seq:
        value = seq[item_id]
        if isinstance(value, int):
            if value in (1, 2):
                bold = value == 1
            elif value in (3, 4):
                italic = value == 3
            else:
                raise ValueError('Unsupported native inline format code')
        elif value == '\n':
            finish()
            spans = []
            start = item_id
        elif value:
            if spans and spans[-1][1:] == (bold, italic):
                previous = spans[-1]
                spans[-1] = (previous[0] + value, bold, italic)
            else:
                spans.append((value, bold, italic))
    finish()
    return '\n'.join(lines)
