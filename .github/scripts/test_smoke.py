import importlib.util
from pathlib import Path
import unittest

class SmokeTests(unittest.TestCase):
    def test_health_metadata_is_required_and_bounded(self):
        import smoke_image
        valid = {'Test': ['CMD', '/usr/local/bin/healthcheck'], 'Interval': 30000000000,
                 'Timeout': 5000000000, 'StartPeriod': 10000000000, 'Retries': 3}
        self.assertTrue(hasattr(smoke_image, 'validate_healthcheck'), 'Smoke must validate actual image health metadata')
        smoke_image.validate_healthcheck({'Healthcheck': valid})
        for key in valid:
            with self.subTest(missing=key), self.assertRaises(ValueError):
                smoke_image.validate_healthcheck({'Healthcheck': {k: v for k, v in valid.items() if k != key}})
        for invalid in ({}, {'Healthcheck': {'Test': ['NONE']}}, {'Healthcheck': dict(valid, Timeout=60000000000)}):
            with self.assertRaises(ValueError):
                smoke_image.validate_healthcheck(invalid)

    def test_static_inventory_requires_both_spas_and_bundled_font(self):
        path = Path(__file__).with_name('smoke_image.py')
        self.assertTrue(path.exists(), 'container smoke checks are not implemented')
        spec = importlib.util.spec_from_file_location('smoke_image', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        inventory = ['/app/static/index.html', '/app/static/_/index.html', '/app/static/_app/immutable/a.js', '/app/static/_/_app/immutable/b.js', '/app/static/_app/immutable/font.woff2']
        self.assertEqual(module.static_paths(inventory), ['/_app/immutable/a.js', '/_/_app/immutable/b.js', '/_app/immutable/font.woff2'])
        for suffix in ('index.html', '_/index.html', '_app/immutable/a.js', '_/_app/immutable/b.js', '_app/immutable/font.woff2'):
            with self.subTest(missing=suffix), self.assertRaises(ValueError):
                module.static_paths([p for p in inventory if p != '/app/static/' + suffix])

if __name__ == '__main__':
    unittest.main()
