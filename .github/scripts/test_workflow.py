"""Contract checks complement actionlint's workflow and expression parsing."""
from pathlib import Path
import re
import unittest


WORKFLOW = Path(__file__).parents[1] / 'workflows' / 'ci.yml'


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.source = WORKFLOW.read_text()

    def test_both_spa_dependencies_are_installed_before_cross_app_checks(self):
        # Web stories import AdminContainer; its config resolves admin-local packages.
        installs = self.source.split('      - name: Install SPA dependencies\n', 1)
        self.assertEqual(len(installs), 2, 'Install both SPAs before checking cross-app stories')
        setup, checks = installs[1].split('      - name: User SPA\n', 1)
        self.assertIn('npm ci --prefix web --no-audit --no-fund', setup)
        self.assertIn('npm ci --prefix admin --no-audit --no-fund', setup)
        self.assertIn('npm run check', checks)

    def test_every_action_is_pinned_to_a_full_commit(self):
        actions = re.findall(r'uses: ([^\s]+)', self.source)
        self.assertTrue(actions)
        for action in actions:
            self.assertRegex(action, r'^[\w-]+/[\w-]+@[0-9a-f]{40}$')

    def test_only_trusted_main_publication_jobs_receive_package_write(self):
        self.assertIn('permissions:\n  contents: read\n', self.source)
        self.assertNotIn('pull_request_target:', self.source)
        self.assertNotIn('write-all', self.source)
        self.assertEqual(set(re.findall(r'secrets\.([A-Za-z_][A-Za-z_0-9]*)', self.source)), {'GITHUB_TOKEN'})
        jobs = dict(re.findall(r'^  ([\w-]+):\n(.*?)(?=^  [\w-]+:\n|\Z)', self.source.split('\njobs:\n', 1)[1], re.M | re.S))
        self.assertEqual(set(jobs), {'test', 'native-image', 'publish'})
        self.assertNotIn('packages: write', jobs['test'])
        self.assertNotIn('login-action', jobs['test'])
        guard = "if: github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')"
        for name in ('native-image', 'publish'):
            self.assertIn(guard, jobs[name])
            self.assertIn('permissions:\n      contents: read\n      packages: write\n', jobs[name])
        self.assertIn('needs: test\n', jobs['native-image'])
        self.assertIn('needs: [test, native-image]\n', jobs['publish'])
        self.assertNotIn('always()', jobs['publish'])

    def test_native_digest_smoke_precedes_receipt_and_manifest_publication(self):
        self.assertIn('runner: ubuntu-24.04\n', self.source)
        self.assertIn('runner: ubuntu-24.04-arm\n', self.source)
        self.assertNotIn('setup-qemu', self.source)
        self.assertIn('push-by-digest=true', self.source)
        self.assertIn('provenance: false', self.source)
        self.assertIn('sbom: false', self.source)
        self.assertIn('cancel-in-progress: false', self.source)
        self.assertLess(self.source.index('smoke_image.py'), self.source.index('uses: actions/upload-artifact@'))
        self.assertIn('python3 .github/scripts/release.py', self.source)


if __name__ == '__main__':
    unittest.main()
