"""Allowlisted, deterministic AMO source archive; never archive the working tree."""
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parents[2]
files = []
for path in ['extension/src', 'extension/static', 'extension/scripts', 'extension/tests', 'contracts/bindings']:
    files.extend(p for p in (root / path).rglob('*') if p.is_file())
files.extend(root / p for p in ['extension/listing/assets.json', 'extension/listing/popup.png', 'extension/listing/settings.png'])
files.extend(root / p for p in ['web/src/lib/styles/presentation.css', 'extension/package.json', 'extension/package-lock.json', 'extension/tsconfig.json', 'extension/README.md', 'extension/FIREFOX-PUBLICATION.md', 'extension/amo-metadata.json', 'extension/reviewer-compose.yaml', '.github/workflows/firefox.yml'])
output = root / 'extension/dist/firefox-source.zip'
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(files):
        info = zipfile.ZipInfo(path.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
    archive.writestr(zipfile.ZipInfo('README.md', (1980, 1, 1, 0, 0, 0)), 'Build instructions: extension/FIREFOX-PUBLICATION.md, Reproduce from source section.\n')
print(output.name)
