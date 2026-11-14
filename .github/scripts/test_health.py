"""Probe control-flow regressions; native image smoke exercises real curl."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


class HealthTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('HEALTH_TEST_IMAGE'), 'Requires the built native runtime image')
    def test_real_curl_http_status_timeout_and_connection_failure(self):
        image = os.environ['HEALTH_TEST_IMAGE']
        for status in ('200', '204', '301', '404', '500', 'timeout', 'closed'):
            with self.subTest(status=status):
                name = 'health-probe-' + uuid.uuid4().hex
                # The fixture owns its network namespace; no host ports are bound.
                server = '' if status == 'closed' else (
                    'sleep 10 | nc -l -p 3000 &' if status == 'timeout' else
                    f"printf 'HTTP/1.1 {status} Fixture\\r\\nContent-Length: 0\\r\\nLocation: /_health\\r\\nConnection: close\\r\\n\\r\\n' | nc -l -p 3000 &")
                script = server + '\nsleep 0.2\nexec /usr/local/bin/healthcheck'
                try:
                    started = time.monotonic()
                    result = subprocess.run(['docker', 'run', '--name', name, '--no-healthcheck', '--env', 'http_proxy=http://127.0.0.1:9', '--env', 'ALL_PROXY=http://127.0.0.1:9', '--entrypoint', 'sh', image, '-c', script], capture_output=True, timeout=15)
                    self.assertEqual(result.returncode == 0, status == '200', result.stderr.decode())
                    self.assertLess(time.monotonic() - started, 12)
                finally:
                    subprocess.run(['docker', 'rm', '-fv', name], check=False, capture_output=True, timeout=15)

    def test_native_alpine_recipe_and_docker_health_metadata(self):
        recipe = (ROOT / 'Dockerfile').read_text()
        self.assertRegex(recipe, r'FROM --platform=\$TARGETPLATFORM rust:[^ ]*alpine[^ ]*@sha256:[0-9a-f]{64} AS backend')
        self.assertRegex(recipe, r'FROM alpine:[^ ]+@sha256:[0-9a-f]{64} AS runtime')
        self.assertIn('HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3', recipe)
        self.assertIn('CMD ["/usr/local/bin/healthcheck"]', recipe)
        self.assertNotIn('toolchain.sh', recipe)
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('oci-mediatypes=false', workflow)

    def test_probe_requires_successful_curl_and_exact_200(self):
        probe = ROOT / 'packaging/healthcheck.sh'
        self.assertTrue(probe.exists(), 'A bounded container health probe is required')
        with tempfile.TemporaryDirectory() as directory:
            curl = Path(directory, 'curl')
            curl.write_text('#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS"\nprintf "%s" "$STATUS"\nexit "$RESULT"\n')
            curl.chmod(0o755)
            args = Path(directory, 'args')
            for status, result, healthy in [('200', 0, True), ('301', 0, False), ('204', 0, False), ('401', 0, False), ('500', 0, False), ('200', 28, False), ('000', 7, False)]:
                with self.subTest(status=status, result=result):
                    env = dict(os.environ, PATH=directory + ':' + os.environ['PATH'], STATUS=status, RESULT=str(result), ARGS=str(args))
                    completed = subprocess.run(['sh', str(probe)], env=env, capture_output=True, timeout=5)
                    self.assertEqual(completed.returncode == 0, healthy)
                    self.assertEqual(completed.stdout, b'')
                    self.assertEqual(completed.stderr, b'')
                    flags = args.read_text().splitlines()
                    self.assertEqual(flags[0], '--disable')
                    for option, value in [('--max-time', '3'), ('--noproxy', '*'), ('--proto', '=http')]:
                        self.assertEqual(flags[flags.index(option) + 1], value)
                    self.assertEqual(flags[-1], 'http://127.0.0.1:3000/_health')
                    self.assertNotIn('--location', flags)
                    self.assertNotIn('-L', flags)


if __name__ == '__main__':
    unittest.main()
