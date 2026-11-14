"""Exercise a native image against fresh disposable SQLite state and loopback SMTP."""
import json
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid


def static_paths(inventory: list[str]) -> list[str]:
    for page in ('/app/static/index.html', '/app/static/_/index.html'):
        if page not in inventory:
            raise ValueError('Missing SPA entry point')
    paths = []
    for prefix, extension in (('/app/static/_app/', '.js'), ('/app/static/_/_app/', '.js'), ('/app/static/', '.woff2')):
        matches = sorted(p for p in inventory if p.startswith(prefix) and p.endswith(extension))
        if not matches:
            raise ValueError('Missing native image static asset')
        paths.append(matches[0].removeprefix('/app/static'))
    return paths


def main(image: str, architecture: str, *, pull: bool = True) -> None:
    def docker(*args: str) -> str:
        return subprocess.check_output(['docker', *args], text=True).strip()

    if pull:
        docker('pull', image)
    metadata = json.loads(docker('image', 'inspect', image))[0]
    if metadata['Architecture'] != architecture or metadata['Os'] != 'linux':
        raise ValueError('Image is not the requested native Linux architecture')
    if metadata['Config']['User'] != '10001:10001':
        raise ValueError('Image must run as the expected non-root user')
    name = 'image-smoke-' + uuid.uuid4().hex
    volume = name + '-data'
    docker('volume', 'create', volume)
    try:
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory, 'runtime.env')
            env_file.write_text('\n'.join([
                'APP_ORIGIN=http://localhost:3000', 'SHORT_DOMAIN=example.com',
                'DATABASE_PATH=/app/data/smoke.sqlite', 'STATIC_DIR=/app/static',
                'ADMIN_TOKEN=' + secrets.token_hex(32),
                'ANALYTICS_SECRET=' + secrets.token_hex(32),
                'SMTP_HOST=127.0.0.1', 'SMTP_PORT=1025', 'SMTP_SECURITY=plain',
            ]) + '\n')
            env_file.chmod(0o600)
            docker('run', '-d', '--name', name, '--env-file', str(env_file),
                   '--mount', f'type=volume,src={volume},dst=/app/data',
                   '-p', '127.0.0.1::3000', image)
            binding = json.loads(docker('inspect', name))[0]['NetworkSettings']['Ports']['3000/tcp'][0]
            base = 'http://127.0.0.1:' + binding['HostPort']

            def request(path: str) -> tuple[bytes, str]:
                with urllib.request.urlopen(base + path, timeout=5) as response:
                    if response.status != 200:
                        raise ValueError('Unexpected HTTP status')
                    return response.read(), response.headers.get_content_type()

            for attempt in range(60):
                try:
                    body, content_type = request('/_health')
                    if not body:
                        raise ValueError('Empty health response')
                    break
                except (OSError, urllib.error.URLError):
                    if attempt == 59:
                        raise RuntimeError('Image did not become healthy') from None
                    time.sleep(1)
            for path in ('/', '/_/'):
                body, content_type = request(path)
                if content_type != 'text/html' or b'<html' not in body.lower():
                    raise ValueError('Missing rendered SPA entry point')
            inventory = docker('exec', name, 'find', '/app/static', '-type', 'f').splitlines()
            for path in static_paths(inventory):
                body, content_type = request(path)
                if not body or content_type == 'text/html':
                    raise ValueError('Static asset fell back to an HTML document')
                if path.endswith('.woff2') and not body.startswith(b'wOF2'):
                    raise ValueError('Bundled font is not WOFF2')
            docker('exec', name, 'sh', '-ec', 'test "$(id -u)" = 10001; test -w /app/data; test -s /app/data/smoke.sqlite')
            # Stop before copying; retain any SQLite journal files in the snapshot.
            docker('stop', '--time', '15', name)
            database = Path(directory, 'smoke.sqlite')
            docker('cp', name + ':/app/data/.', directory)
            with sqlite3.connect(database) as connection:
                if connection.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                    raise ValueError('Disposable SQLite integrity check failed')
                if connection.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0] == 0:
                    raise ValueError('Application did not initialize the writable data directory')
            print(f'Native {architecture} image passed health, both SPAs, static assets, font, non-root and SQLite checks.')
    finally:
        subprocess.run(['docker', 'rm', '-f', name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        docker('volume', 'rm', volume)


if __name__ == '__main__':
    main(*sys.argv[1:])
