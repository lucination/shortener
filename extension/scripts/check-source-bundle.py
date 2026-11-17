from pathlib import Path
import hashlib, subprocess, tempfile, zipfile, json
root = Path(__file__).resolve().parents[2]
subprocess.run(['python3', 'scripts/source-bundle.py'], cwd=root/'extension', check=True)
expected = (root/'extension/dist/firefox.zip').read_bytes()
with tempfile.TemporaryDirectory(prefix='firefox-repro-') as temp:
    with zipfile.ZipFile(root/'extension/dist/firefox-source.zip') as source:
        names = source.namelist()
        assert not any(x in name for name in names for x in ['node_modules', '.env', '.git/', 'artifacts/', 'amo-evidence'])
        assert all(not name.startswith('/') and '..' not in Path(name).parts for name in names)
        source.extractall(temp)
    work = Path(temp)/'extension'
    subprocess.run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=work, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['npm', 'run', 'build'], cwd=work, check=True, stdout=subprocess.DEVNULL)
    observed = (work/'dist/firefox.zip').read_bytes()
    assert observed == expected, 'source rebuild differs from submitted add-on'
    print(json.dumps({'source_rebuild_equal': True, 'sha256': hashlib.sha256(observed).hexdigest(), 'source_entries': len(names)}))
