"""Contract checks complement actionlint's workflow and expression parsing."""
from pathlib import Path
import re
import shlex
import shutil
import tempfile
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

    def test_extension_locked_dependencies_are_installed_before_checks(self):
        test_job = self.source.split('\n  test:\n', 1)[1].split('\n  native-image:\n', 1)[0]
        commands = [shlex.split(line.strip()) for line in test_job.splitlines()
                    if line.strip().startswith('npm ')]
        extension_commands = [command for command in commands if 'extension' in command]
        self.assertTrue(extension_commands, 'Must execute extension verification')
        self.assertEqual(extension_commands[0],
                         ['npm', 'ci', '--prefix', 'extension', '--ignore-scripts',
                          '--no-audit', '--no-fund'],
                         'Install locked extension-local devDependencies without lifecycle scripts before checks')
        self.assertIn(['npm', 'run', 'check', '--prefix', 'extension'], extension_commands)
        self.assertIn(['npm', 'test', '--prefix', 'extension'], extension_commands)
        self.assertNotIn('continue-on-error:', test_job)
        self.assertNotIn('secrets.', test_job)

    def test_every_action_is_pinned_to_a_full_commit(self):
        actions = re.findall(r'uses: ([^\s]+)', self.source)
        self.assertTrue(actions)
        for action in actions:
            self.assertRegex(action, r'^[\w-]+/[\w-]+@[0-9a-f]{40}$')

    def test_backend_copy_inputs_contain_rust_compile_time_assets(self):
        root = WORKFLOW.parents[2]
        recipe = (root / 'Dockerfile').read_text()
        backend = recipe.split(' AS backend\n', 1)[1].split('\nFROM ', 1)[0]
        # Stage the real COPY inputs, including glob expansion and directory
        # contents, rather than maintaining a second extension allowlist.
        with tempfile.TemporaryDirectory() as directory:
            staged = Path(directory)
            for line in backend.splitlines():
                if not line.startswith('COPY '):
                    continue
                *sources, destination = shlex.split(line)[1:]
                self.assertFalse(any(s.startswith('--') for s in sources),
                                 'Extend staging for new backend COPY options')
                target = staged / destination.removeprefix('/app/').lstrip('/')
                for source in sources:
                    matches = list(root.glob(source))
                    self.assertTrue(matches, f'No backend COPY inputs: {source}')
                    for path in matches:
                        if path.is_dir():
                            shutil.copytree(path, target, dirs_exist_ok=True)
                        else:
                            target.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(path, target / path.name)
            includes = 0
            for source in staged.rglob('*.rs'):
                text = source.read_text()
                macros = re.findall(r'include_(?:str|bytes)!\s*\(', text)
                paths = re.findall(r'include_(?:str|bytes)!\s*\(\s*"([^"\n]+)"\s*\)', text)
                self.assertEqual(len(paths), len(macros),
                                 f'Extend dependency discovery for nonliteral include in {source.relative_to(staged)}')
                for asset in paths:
                    includes += 1
                    dependency = source.parent / asset
                    self.assertTrue(dependency.is_file(),
                                    f'Backend COPY omits {source.relative_to(staged)} -> {asset}')
                    original = root / source.relative_to(staged).parent / asset
                    self.assertEqual(dependency.read_bytes(), original.read_bytes())
            self.assertGreater(includes, 0, 'Must discover actual Rust compile-time dependencies')

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
        self.assertIn('oci-mediatypes=false', self.source)
        self.assertIn('HEALTH_TEST_IMAGE="$IMAGE" python3 -m unittest discover -s .github/scripts -p test_health.py -v', self.source)
        self.assertIn('provenance: false', self.source)
        self.assertIn('sbom: false', self.source)
        self.assertIn('cancel-in-progress: false', self.source)
        self.assertLess(self.source.index('smoke_image.py'), self.source.index('uses: actions/upload-artifact@'))
        self.assertIn('python3 .github/scripts/release.py', self.source)


if __name__ == '__main__':
    unittest.main()
