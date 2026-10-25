"""Manual, create-only cloud probe. Reuses the existing macOS NotesDive credential.

No scheduled synchronization; no overwrites or deletes. Credentials stay in memory.
"""
import argparse
import base64
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
from uuid import uuid4
import zipfile

from remarkable_text_probe import encode, decode, write_new
from remarkable_markdown import encode_markdown, decode_markdown

AUTH = 'https://webapp-prod.cloud.remarkable.engineering'
SYNC = 'https://internal.cloud.remarkable.com'
MAX_BYTES = 16 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


@dataclass(frozen=True)
class Entry:
    hash: str
    kind: str
    id: str
    count: int
    size: int

    def line(self):
        return f'{self.hash}:{self.kind}:{self.id}:{self.count}:{self.size}'


def parse_index(data):
    lines = data.decode('utf-8').splitlines()
    if not lines or lines[0] not in ('3', '4'):
        raise ValueError('Unsupported index schema')
    expected = None
    if lines[0] == '4':
        header = lines[1].split(':')
        if len(header) != 4 or header[0] != '0' or not header[1]:
            raise ValueError('Invalid v4 index header')
        expected = int(header[2])
    result = []
    for line in lines[2 if expected is not None else 1:]:
        if not line:
            continue
        h, kind, name, count, size = line.split(':')
        if len(h) != 64 or len(bytes.fromhex(h)) != 32 or not name:
            raise ValueError('Invalid index entry')
        entry = Entry(h, kind, name, int(count), int(size))
        if entry.count < 0 or entry.size < 0:
            raise ValueError('Invalid index size')
        result.append(entry)
    if len({e.id for e in result}) != len(result) or (expected is not None and expected != len(result)):
        raise ValueError('Duplicate or missing index entries')
    return result


def root_body(entries):
    entries = sorted(entries, key=lambda e: e.id)
    # v4 document entries have type 0. Preserve every ID/hash/count/size.
    lines = [f'4\n0:.:{len(entries)}:{sum(e.size for e in entries)}']
    lines += [Entry(e.hash, '0', e.id, e.count, e.size).line() for e in entries]
    return ('\n'.join(lines) + '\n').encode()


def doc_index(files):
    entries = sorted([Entry(digest(data), '0', name, 0, len(data)) for name, data in files.items()], key=lambda e: e.id)
    body = ('3\n' + '\n'.join(e.line() for e in entries) + '\n').encode()
    # v3 document hashes are SHA256 over child hashes, not serialized indexes.
    return digest(b''.join(bytes.fromhex(e.hash) for e in entries)), body, entries


def crc32c(data):
    crc = 0xffffffff
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82f63b78 if crc & 1 else 0)
    return base64.b64encode((crc ^ 0xffffffff).to_bytes(4, 'big')).decode()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Cloud:
    def __init__(self):
        self.opener = urllib.request.build_opener(NoRedirect)
        credential = subprocess.run([
            '/usr/bin/security', 'find-generic-password', '-s',
            'app.notesdive.remarkable', '-a', 'device', '-w',
        ], capture_output=True, text=True, timeout=60)
        if credential.returncode or not credential.stdout.strip():
            raise RuntimeError('Existing NotesDive credential unavailable')
        self.token = credential.stdout.strip()
        self.token = self.request('POST', AUTH + '/token/json/2/user/new', b'').decode().strip()
        if not self.token:
            raise RuntimeError('Empty cloud session')

    def request(self, method, url, data=None, filename=None):
        headers = {'Authorization': 'Bearer ' + self.token, 'User-Agent': 'rmapi'}
        if filename:
            headers['rm-filename'] = filename
        if data is not None:
            headers['Content-Type'] = 'text/plain; charset=UTF-8' if filename == 'root.docSchema' else 'application/octet-stream'
            headers['x-goog-hash'] = 'crc32c=' + crc32c(data)
        if url.endswith('/sync/v3/root'):
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=30) as response:
                result = response.read(MAX_BYTES + 1)
        except urllib.error.HTTPError as error:
            # Never print response bodies, headers or credentials.
            raise RuntimeError(f'Cloud HTTP {error.code}; no automatic retry. Re-check the same manifest.') from None
        if len(result) > MAX_BYTES:
            raise RuntimeError('Cloud response exceeds probe limit')
        return result

    def root(self):
        root = json.loads(self.request('GET', SYNC + '/sync/v4/root'))
        entries = parse_index(self.blob(root['hash'], 'root.docSchema'))
        return root, entries

    def blob(self, hash_value, name):
        if len(hash_value) != 64 or len(bytes.fromhex(hash_value)) != 32:
            raise ValueError('Invalid blob hash')
        return self.request('GET', SYNC + '/sync/v3/files/' + hash_value, filename=name)

    def metadata(self, entry):
        index = parse_index(self.blob(entry.hash, entry.id + '.docSchema'))
        meta = next(e for e in index if e.id == entry.id + '.metadata')
        raw = self.blob(meta.hash, meta.id)
        if digest(raw) != meta.hash:
            raise RuntimeError('Metadata hash mismatch')
        return json.loads(raw), index


def prepare(source, project, directory, rich=True, name=None):
    config = json.loads(project.read_bytes())
    targets = config.get('remarkableFolders', [])
    if len(targets) != 1:
        raise ValueError('Probe requires exactly one linked reMarkable folder')
    target = targets[0]
    original = source.read_bytes()
    page_data = (encode_markdown if rich else encode)(original.decode('utf-8'))
    canonical = (decode_markdown if rich else decode)(page_data).encode()
    if not rich and canonical != original:
        raise ValueError('Local text conversion failed')
    doc_id, page_id = str(uuid4()), str(uuid4())
    name = name or source.stem + (' - NotesDive opmaakproef' if rich else ' - NotesDive proef')
    content = {
        'fileType': 'notebook', 'dummyDocument': False, 'fontName': '',
        'lastOpenedPage': 0, 'lineHeight': -1, 'margins': 100,
        'orientation': 'portrait', 'pageCount': 1, 'pages': [page_id],
        'textScale': 1, 'tags': [], 'pageTags': [], 'extraMetadata': {},
    }
    metadata = {
        'visibleName': name, 'type': 'DocumentType', 'parent': target['id'],
        'lastModified': str(int(time.time() * 1000)), 'version': 1,
        'deleted': False, 'pinned': False, 'synced': False,
    }
    files = {
        doc_id + '.metadata': json_bytes(metadata),
        doc_id + '.content': json_bytes(content),
        doc_id + '.pagedata': b'Blank\n',
        doc_id + '/' + page_id + '.rm': page_data,
    }
    manifest = {
        'documentId': doc_id, 'pageId': page_id, 'name': name,
        'parentId': target['id'], 'parentName': target['name'],
        'source': str(source.resolve()), 'sourceSha256': digest(original),
        'textEncoding': 'native-markdown' if rich else 'markdown-source',
        'canonicalMarkdownSha256': digest(canonical),
        'files': {name: digest(data) for name, data in files.items()},
    }
    directory.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        path = directory / 'package' / name
        path.parent.mkdir(parents=True, exist_ok=True)
        write_new(path, data)
    with zipfile.ZipFile(directory / 'Sync-proef.rmdoc', 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    write_new(directory / 'manifest.json', json_bytes(manifest))
    return manifest


def load_package(directory):
    manifest = json.loads((directory / 'manifest.json').read_bytes())
    files = {}
    for name, hash_value in manifest['files'].items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts:
            raise ValueError('Invalid package path')
        raw = (directory / 'package' / path).read_bytes()
        if digest(raw) != hash_value:
            raise ValueError('Prepared package changed')
        files[name] = raw
    return manifest, files


def upload(cloud, manifest, files):
    root, entries = cloud.root()
    doc_id = manifest['documentId']
    if any(e.id == doc_id for e in entries):
        return {'alreadyPresent': True, 'documentId': doc_id}
    parent = next(e for e in entries if e.id == manifest['parentId'])
    metadata, _ = cloud.metadata(parent)
    if metadata.get('type') != 'CollectionType' or metadata.get('deleted') or metadata.get('visibleName') != manifest['parentName'] or metadata.get('parent') == 'trash':
        raise ValueError('Linked destination is unavailable or changed')
    doc_hash, index, subentries = doc_index(files)
    for entry in subentries:
        cloud.request('PUT', SYNC + '/sync/v3/files/' + entry.hash, files[entry.id], entry.id)
    cloud.request('PUT', SYNC + '/sync/v3/files/' + doc_hash, index, doc_id + '.docSchema')
    new_entries = entries + [Entry(doc_hash, '0', doc_id, len(files), sum(map(len, files.values())))]
    body = root_body(new_entries)
    root_hash = digest(body)
    cloud.request('PUT', SYNC + '/sync/v3/files/' + root_hash, body, 'root.docSchema')
    # Generation-checked root update is the only step that makes the new note visible.
    current, _ = cloud.root()
    if current != root:
        raise RuntimeError('Library changed during preparation; retry with the same manifest')
    response = json.loads(cloud.request('PUT', SYNC + '/sync/v3/root', json_bytes({
        'hash': root_hash, 'generation': root['generation'], 'broadcast': True,
    }), 'roothash'))
    if response.get('hash') != root_hash:
        raise RuntimeError('Upload outcome uncertain; verify using the same manifest')
    return {'documentId': doc_id, 'generation': response['generation'], 'created': True}


def fetch(cloud, manifest, directory):
    _, entries = cloud.root()
    entry = next(e for e in entries if e.id == manifest['documentId'])
    metadata, index = cloud.metadata(entry)
    if metadata.get('parent') != manifest['parentId'] or metadata.get('deleted'):
        raise ValueError('Probe document moved or deleted')
    content_entry = next(e for e in index if e.id.endswith('.content'))
    content_raw = cloud.blob(content_entry.hash, content_entry.id)
    if digest(content_raw) != content_entry.hash:
        raise RuntimeError('Downloaded content hash mismatch')
    content = json.loads(content_raw)
    pages = content.get('cPages', {}).get('pages', content.get('pages', []))
    page_ids = [p if isinstance(p, str) else p['id'] for p in pages]
    if page_ids != [manifest['pageId']]:
        raise ValueError('Probe supports its original single page only')
    page = next(e for e in index if e.id.endswith('/' + manifest['pageId'] + '.rm'))
    raw = cloud.blob(page.hash, page.id)
    if digest(raw) != page.hash:
        raise RuntimeError('Downloaded page hash mismatch')
    directory.mkdir(parents=True, exist_ok=False)
    write_new(directory / 'Sync-proef-van-remarkable.rm', raw)
    # Keep the native scene (including handwriting) even if text extraction
    # rejects newly applied formatting. Never write over the source Markdown.
    if manifest.get('textEncoding') == 'native-markdown':
        text = decode_markdown(raw).encode()
    else:
        try:
            text = decode(raw).encode()
        except ValueError as error:
            if 'formatting' not in str(error):
                raise
            # A source-text trial may be formatted manually on the tablet.
            # Retain its existing Markdown punctuation alongside native styles.
            text = decode_markdown(raw, escape=False).encode()
    write_new(directory / 'Sync-proef-van-remarkable.md', text)
    report = {
        'documentId': entry.id, 'name': metadata['visibleName'],
        'parentName': manifest['parentName'], 'revision': entry.hash,
        'returnedSha256': digest(text), 'sameAsOriginal': digest(text) == manifest['sourceSha256'],
        'sameAsPreparedMarkdown': digest(text) == manifest.get('canonicalMarkdownSha256', manifest['sourceSha256']),
        'sourceOverwritten': False, 'deviceEditVerified': False,
    }
    write_new(directory / 'result.json', json_bytes(report))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    prep = commands.add_parser('prepare')
    prep.add_argument('source', type=Path)
    prep.add_argument('project', type=Path)
    prep.add_argument('directory', type=Path)
    prep.add_argument('--rich', action='store_true')
    prep.add_argument('--source-text', dest='rich', action='store_false')
    prep.set_defaults(rich=True)
    prep.add_argument('--name')
    for command in ['upload', 'fetch']:
        sub = commands.add_parser(command)
        sub.add_argument('directory', type=Path)
        if command == 'fetch':
            sub.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.command == 'prepare':
        result = prepare(args.source, args.project, args.directory, args.rich, args.name)
    else:
        manifest, files = load_package(args.directory)
        cloud = Cloud()
        result = upload(cloud, manifest, files) if args.command == 'upload' else fetch(cloud, manifest, args.output)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
