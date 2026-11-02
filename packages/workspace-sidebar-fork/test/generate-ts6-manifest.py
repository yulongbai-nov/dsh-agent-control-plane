"""Regenerate the compiler file inventory from the exact upstream lock tarball.

Reads one local tarball and writes JSON to stdout; never extracts its entries.
"""
import base64
import hashlib
import io
import json
import pathlib
import sys
import tarfile

expected = 'sha512-y2TvuxSZPDyQakkFRPZHKFm+KKVqIisdg9/CZwm9ftvKXLP8NRWj38/ODjNbr43SsoXqNuAisEf1GdCxqWcdBw=='
if len(sys.argv) != 2:
    raise SystemExit('usage: generate-ts6-manifest.py typescript-6.0.3.tgz')
data = pathlib.Path(sys.argv[1]).read_bytes()
actual = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode('ascii')
if actual != expected:
    raise SystemExit('tarball does not match pinned upstream lockfile integrity')
files = {}
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    for entry in archive:
        path = pathlib.PurePosixPath(entry.name)
        if not entry.isfile() or not entry.name.startswith('package/') or '..' in path.parts:
            raise SystemExit('unexpected archive entry')
        name = entry.name.removeprefix('package/')
        if not name or name in files:
            raise SystemExit('duplicate or empty archive path')
        files[name] = hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
if len(files) != 140:
    raise SystemExit('unexpected compiler file count')
print(json.dumps({'version':'6.0.3','tarballIntegrity':expected,'files':dict(sorted(files.items()))}, indent=2))
