"""Fetch fixed official archives, verify SHA-256 BEFORE extraction; no AMO access."""
import hashlib
import json
import os
from pathlib import Path
import tarfile
import urllib.request


def verified(path, digest):
    return path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest


def install(root):
    pins = json.loads(Path(__file__).with_name('native-toolchain.json').read_text())
    root.mkdir(parents=True, exist_ok=True)
    for pin in pins.values():
        archive = root / pin['archive']
        if not verified(archive, pin['sha256']):
            partial = archive.with_suffix(archive.suffix + '.partial')
            try:
                with urllib.request.urlopen(pin['url'], timeout=60) as response, partial.open('wb') as out:
                    total = 0
                    while data := response.read(1024 * 1024):
                        total += len(data)
                        if total > 120 * 1024 * 1024:
                            raise ValueError('browser archive exceeded bounded download budget')
                        out.write(data)
                if not verified(partial, pin['sha256']):
                    raise ValueError('official browser archive SHA-256 mismatch')
                partial.replace(archive)
            finally:
                partial.unlink(missing_ok=True)
        with tarfile.open(archive) as tar:
            tar.extractall(root, filter='data')
    print('Verified official Firefox ' + pins['firefox']['version'] + ' and geckodriver ' + pins['geckodriver']['version'])


if __name__ == '__main__':
    install(Path(os.environ['FIREFOX_TOOLS']))
