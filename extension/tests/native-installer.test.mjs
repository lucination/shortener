import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
test("official browser pins are fixed HTTPS and checksum verification rejects altered bytes", async () => {
  const pins = JSON.parse(
    await readFile(
      new URL("../scripts/native-toolchain.json", import.meta.url),
    ),
  );
  assert.equal(pins.firefox.version, "160.0.1");
  assert.equal(pins.geckodriver.version, "0.36.0");
  assert.match(
    pins.firefox.url,
    /^https:\/\/archive\.mozilla\.org\/pub\/firefox\/releases\/160\.0\.1\//,
  );
  assert.match(
    pins.geckodriver.url,
    /^https:\/\/github\.com\/mozilla\/geckodriver\/releases\/download\/v0\.36\.0\//,
  );
  for (const pin of Object.values(pins))
    assert.match(pin.sha256, /^[a-f0-9]{64}$/);
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import importlib.util,pathlib,tempfile,hashlib
spec=importlib.util.spec_from_file_location('installer','scripts/install-native-tools.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)/'archive';p.write_bytes(b'official fixture');digest=hashlib.sha256(p.read_bytes()).hexdigest();assert m.verified(p,digest)
 p.write_bytes(b'altered fixture');assert not m.verified(p,digest);assert not m.verified(p.with_name('missing'),digest)
`,
    ],
    {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
});
