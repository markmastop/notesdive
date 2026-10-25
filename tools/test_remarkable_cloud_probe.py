import base64
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from remarkable_cloud_probe import Entry, SYNC, crc32c, digest, doc_index, parse_index, prepare, load_package, root_body, upload, fetch
from remarkable_text_probe import encode


class FakeCloud:
    def __init__(self, changed=False, existing=False):
        self.calls = []
        self.reads = 0
        self.changed = changed
        self.entries = [Entry('a' * 64, '0', 'parent', 2, 20), Entry('b' * 64, '0', 'other', 3, 30)]
        if existing:
            self.entries.append(Entry('c' * 64, '0', 'new', 1, 1))

    def root(self):
        self.reads += 1
        return {'hash': 'd' * 64, 'generation': 2 if self.changed and self.reads > 1 else 1}, self.entries

    def metadata(self, entry):
        return {'type': 'CollectionType', 'visibleName': 'Target', 'parent': ''}, []

    def request(self, method, url, data, name):
        self.calls.append((method, url, data, name))
        if url.endswith('/sync/v3/root'):
            value = json.loads(data)
            return json.dumps({'hash': value['hash'], 'generation': 2}).encode()
        return b''


class CloudProbeTests(unittest.TestCase):
    def test_checksums_and_canonical_root(self):
        self.assertEqual(base64.b64decode(crc32c(b'123456789')).hex(), 'e3069283')
        entries = [Entry('a' * 64, '80000000', 'z', 2, 12), Entry('b' * 64, '0', 'a', 3, 10)]
        parsed = parse_index(root_body(entries))
        self.assertEqual([e.id for e in parsed], ['a', 'z'])
        self.assertEqual([e.kind for e in parsed], ['0', '0'])
        self.assertEqual(sum(e.size for e in parsed), 22)
        document_v4 = root_body(entries).replace(b'0:.:2:22', b'0:document-id:2:22')
        self.assertEqual(parse_index(document_v4), parsed)
        with self.assertRaises(ValueError):
            parse_index(root_body([entries[0], entries[0]]))

    def test_document_hash_uses_ordered_child_hashes(self):
        hash_value, body, entries = doc_index({'b': b'B', 'a': b'A'})
        self.assertEqual(hash_value, digest(bytes.fromhex(digest(b'A')) + bytes.fromhex(digest(b'B'))))
        self.assertEqual(parse_index(body), entries)

    def test_add_only_and_generation_guard(self):
        manifest = {'documentId': 'new', 'parentId': 'parent', 'parentName': 'Target'}
        cloud = FakeCloud()
        self.assertTrue(upload(cloud, manifest, {'new.metadata': b'{}'})['created'])
        root_upload = next(c for c in cloud.calls if c[3] == 'root.docSchema')
        parsed = parse_index(root_upload[2])
        for old in cloud.entries:
            self.assertIn(old, parsed)
        self.assertEqual(len(parsed), len(cloud.entries) + 1)
        update = json.loads(cloud.calls[-1][2])
        self.assertEqual(update['generation'], 1)
        self.assertTrue(update['broadcast'])
        changed = FakeCloud(changed=True)
        with self.assertRaisesRegex(RuntimeError, 'Library changed'):
            upload(changed, manifest, {'new.metadata': b'{}'})
        self.assertFalse(any(c[1] == SYNC + '/sync/v3/root' for c in changed.calls))
        existing = FakeCloud(existing=True)
        self.assertTrue(upload(existing, manifest, {})['alreadyPresent'])
        self.assertEqual(existing.calls, [])

    def test_package_is_native_and_detects_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, project = root / 'test.md', root / 'project.json'
            source.write_text('# Titel\n\n- [ ] proef\n')
            project.write_text(json.dumps({'remarkableFolders': [{'id': 'parent', 'name': 'Target'}]}))
            manifest = prepare(source, project, root / 'probe')
            loaded, files = load_package(root / 'probe')
            self.assertEqual(manifest, loaded)
            with zipfile.ZipFile(root / 'probe' / 'Sync-proef.rmdoc') as archive:
                self.assertEqual(set(archive.namelist()), set(files))
            content = json.loads(files[manifest['documentId'] + '.content'])
            self.assertEqual(content['pages'], [manifest['pageId']])
            self.assertEqual(content['fileType'], 'notebook')
            package_file = root / 'probe' / 'package' / (manifest['documentId'] + '.metadata')
            package_file.write_text('changed')
            with self.assertRaisesRegex(ValueError, 'changed'):
                load_package(root / 'probe')

    def test_fetch_saves_changed_text_without_overwriting_source(self):
        original = b'# Original\n'
        changed = b'# Original\n\nChanged on tablet.\n'
        page = encode(changed.decode())
        content = json.dumps({'pages': ['page']}).encode()
        index = [Entry(digest(page), '0', 'new/page.rm', 0, len(page)),
                 Entry(digest(content), '0', 'new.content', 0, len(content))]
        cloud = FakeCloud(existing=True)
        cloud.metadata = lambda entry: ({'parent': 'parent', 'visibleName': 'Probe'}, index)
        cloud.blob = lambda h, name: content if name.endswith('.content') else page
        manifest = {'documentId': 'new', 'parentId': 'parent', 'parentName': 'Target',
                    'pageId': 'page', 'sourceSha256': digest(original)}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.md'
            source.write_bytes(original)
            report = fetch(cloud, manifest, root / 'return')
            self.assertFalse(report['sameAsOriginal'])
            self.assertEqual((root / 'return' / 'Sync-proef-van-remarkable.md').read_bytes(), changed)
            self.assertEqual((root / 'return' / 'Sync-proef-van-remarkable.rm').read_bytes(), page)
            self.assertEqual(source.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
