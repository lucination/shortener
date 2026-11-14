"""Validate native image receipts before granting a manifest publication capability."""
import json
from pathlib import Path
import re


def read_digests(root: Path) -> dict[str, str]:
    result = {}
    for arch in ('amd64', 'arm64'):
        receipt = json.loads((root / f'{arch}.json').read_text())
        if receipt.get('architecture') != arch or not re.fullmatch(r'sha256:[0-9a-f]{64}', receipt.get('digest', '')):
            raise ValueError('Invalid native image receipt')
        result[arch] = receipt['digest']
    if set(p.name for p in root.iterdir()) != {'amd64.json', 'arm64.json'}:
        raise ValueError('Exactly two native image receipts are required')
    if len(set(result.values())) != 2:
        raise ValueError('Native images must have distinct digests')
    return result


def validate_index(index: dict, expected: dict[str, str]) -> None:
    manifests = index.get('manifests', [])
    actual = {}
    for manifest in manifests:
        platform = manifest.get('platform', {})
        arch = platform.get('architecture')
        if platform.get('os') != 'linux' or arch in actual:
            raise ValueError('Only one descriptor per native Linux platform is allowed')
        actual[arch] = manifest.get('digest')
    if len(manifests) != 2 or actual != expected:
        raise ValueError('Manifest does not match the two smoke-tested image digests')


def publication_allowed(event: str, ref: str, tested: bool, current: bool) -> bool:
    return event in ('push', 'workflow_dispatch') and ref == 'refs/heads/main' and tested and current


def main() -> None:
    import os
    import subprocess
    import urllib.request

    def docker(*args: str) -> str:
        return subprocess.check_output(['docker', 'buildx', 'imagetools', *args], text=True)

    def current_head() -> bool:
        request = urllib.request.Request(
            f"https://api.github.com/repos/{os.environ['GITHUB_REPOSITORY']}/git/ref/heads/main",
            headers={'Authorization': f"Bearer {os.environ['GH_TOKEN']}", 'Accept': 'application/vnd.github+json'},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)['object']['sha'] == os.environ['GITHUB_SHA']

    if not publication_allowed(os.environ['GITHUB_EVENT_NAME'], os.environ['GITHUB_REF'], os.environ['TEST_RESULT'] == 'success', current_head()):
        print('Publication skipped: only a tested, current main revision may publish.')
        return
    image = 'ghcr.io/' + os.environ['GITHUB_REPOSITORY'].lower()
    sha = os.environ['GITHUB_SHA']
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Expected a full commit SHA')
    digests = read_digests(Path('digests'))
    candidate = f'{image}:sha-{sha}'
    docker('create', '--tag', candidate, *(image + '@' + value for value in digests.values()))
    validate_index(json.loads(docker('inspect', '--raw', candidate)), digests)
    # Capture the verified index identity; latest is copied from that immutable digest.
    index_digest = docker('inspect', '--format', '{{.Manifest.Digest}}', candidate).strip()
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', index_digest):
        raise ValueError('Invalid candidate index digest')
    if not current_head():
        print('Latest unchanged: main advanced while the candidate was verified.')
        return
    docker('create', '--tag', image + ':latest', image + '@' + index_digest)
    latest_digest = docker('inspect', '--format', '{{.Manifest.Digest}}', image + ':latest').strip()
    if latest_digest != index_digest:
        raise ValueError('Latest readback does not match the verified index')
    validate_index(json.loads(docker('inspect', '--raw', image + ':latest')), digests)
    print(f'Published and verified {image}:latest at {index_digest}')


if __name__ == '__main__':
    main()
