import importlib.util
from contextlib import redirect_stdout
import json
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))

class ReleaseTests(unittest.TestCase):
    def test_exact_native_digest_pair(self):
        self.assertTrue(SPEC.origin and Path(SPEC.origin).exists(), 'digest validation is not implemented')
        module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for arch, digit in [('amd64', 'a'), ('arm64', 'b')]:
                (root / f'{arch}.json').write_text(json.dumps({'architecture': arch, 'digest': 'sha256:' + digit * 64}))
            self.assertEqual(module.read_digests(root), {'amd64': 'sha256:' + 'a' * 64, 'arm64': 'sha256:' + 'b' * 64})


class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.release = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.release)

    def test_malformed_missing_duplicate_and_extra_receipts_rejected(self):
        for mutation in ('missing', 'duplicate', 'uppercase', 'injection', 'extra', 'wrong-platform'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                pair = {'amd64': {'architecture': 'amd64', 'digest': 'sha256:' + 'a' * 64}, 'arm64': {'architecture': 'arm64', 'digest': 'sha256:' + 'b' * 64}}
                if mutation == 'missing': del pair['arm64']
                if mutation == 'duplicate': pair['arm64']['digest'] = pair['amd64']['digest']
                if mutation == 'uppercase': pair['arm64']['digest'] = 'sha256:' + 'B' * 64
                if mutation == 'injection': pair['arm64']['digest'] = 'sha256:' + 'b' * 64 + ';exit'
                if mutation == 'wrong-platform': pair['arm64']['architecture'] = 'amd64'
                for arch, receipt in pair.items(): (root / f'{arch}.json').write_text(json.dumps(receipt))
                if mutation == 'extra': (root / 'extra.json').write_text('{}')
                with self.assertRaises((ValueError, FileNotFoundError)):
                    self.release.read_digests(root)

    def test_only_exact_pair_of_linux_manifest_descriptors_is_accepted(self):
        digests = {'amd64': 'sha256:' + 'a' * 64, 'arm64': 'sha256:' + 'b' * 64}
        manifests = [{'digest': digest, 'platform': {'os': 'linux', 'architecture': arch}} for arch, digest in digests.items()]
        self.release.validate_index({'manifests': manifests}, digests)
        for altered in [manifests[:1], manifests + manifests[:1], [manifests[0], manifests[0]], [dict(manifests[0], platform={'os': 'windows', 'architecture': 'amd64'}), manifests[1]], [dict(manifests[0], digest='sha256:' + 'c' * 64), manifests[1]]]:
            with self.assertRaises(ValueError): self.release.validate_index({'manifests': altered}, digests)

    def test_pr_failed_stale_and_non_main_runs_cannot_publish(self):
        for event in ('push', 'workflow_dispatch', 'pull_request', 'pull_request_target'):
            for ref in ('refs/heads/main', 'refs/heads/feature'):
                for tested in (True, False):
                    for current in (True, False):
                        expected = event in ('push', 'workflow_dispatch') and ref == 'refs/heads/main' and tested and current
                        self.assertEqual(self.release.publication_allowed(event, ref, tested, current), expected)

class PublicationEffectsTests(unittest.TestCase):
    def setUp(self):
        self.release = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(self.release)

    def exercise(self, heads, *, event='push', test_result='success', invalid_manifest=False):
        sha = 'c' * 40
        pair = {'amd64': 'sha256:' + 'a' * 64, 'arm64': 'sha256:' + 'b' * 64}
        index_digest = 'sha256:' + 'd' * 64
        calls = []

        def command(args, **kwargs):
            calls.append(args)
            if '--raw' in args:
                descriptors = [{'digest': digest, 'platform': {'os': 'linux', 'architecture': arch}} for arch, digest in pair.items()]
                return json.dumps({'manifests': descriptors[:1] if invalid_manifest else descriptors})
            if '--format' in args:
                return index_digest + '\n'
            return ''

        responses = [io.BytesIO(json.dumps({'object': {'sha': sha if current else 'e' * 40}}).encode()) for current in heads]
        environment = {'GITHUB_SHA': sha, 'GITHUB_REPOSITORY': 'OWNER/REPO', 'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': event, 'TEST_RESULT': test_result, 'GH_TOKEN': 'test-only-token'}
        with redirect_stdout(io.StringIO()), patch.dict(os.environ, environment, clear=True), patch.object(self.release, 'read_digests', return_value=pair), patch('urllib.request.urlopen', side_effect=responses), patch('subprocess.check_output', side_effect=command):
            if invalid_manifest:
                with self.assertRaises(ValueError): self.release.main()
            else:
                self.release.main()
        return calls

    def test_pr_failed_and_initially_stale_runs_make_no_registry_calls(self):
        for options in ({'event': 'pull_request'}, {'test_result': 'failure'}, {}):
            with self.subTest(options=options):
                self.assertEqual(self.exercise([False], **options), [])

    def test_head_advance_after_candidate_verification_preserves_latest(self):
        calls = self.exercise([True, False])
        self.assertTrue(any('create' in call for call in calls))
        self.assertFalse(any('ghcr.io/owner/repo:latest' in call for call in calls))

    def test_invalid_candidate_never_updates_latest(self):
        calls = self.exercise([True], invalid_manifest=True)
        self.assertFalse(any('ghcr.io/owner/repo:latest' in call for call in calls))

    def test_latest_is_copied_from_verified_index_and_read_back(self):
        calls = self.exercise([True, True])
        latest_create = [call for call in calls if 'create' in call and 'ghcr.io/owner/repo:latest' in call]
        self.assertEqual(len(latest_create), 1)
        self.assertEqual(latest_create[0][-1], 'ghcr.io/owner/repo@sha256:' + 'd' * 64)
        self.assertEqual(calls[-1][-2:], ['--raw', 'ghcr.io/owner/repo:latest'])


if __name__ == '__main__':
    unittest.main()
