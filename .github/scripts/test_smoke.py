import importlib.util
from pathlib import Path
import unittest

class SmokeTests(unittest.TestCase):
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
