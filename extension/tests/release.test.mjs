import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { admit } from "../scripts/publication-policy.mjs";
const root = new URL("../", import.meta.url);
test("extension builds independently of web application dependencies", () => {
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("0.1.3 fresh official-CLI release keeps matching versions and attempt-one admission", () => {
  const read = path => JSON.parse(readFileSync(new URL(path, root)));
  const pkg = read("package.json");
  const lock = read("package-lock.json");
  const versions = [pkg.version, lock.version, lock.packages[""].version];
  for (const platform of ["chrome", "firefox", "safari"])
    versions.push(read(`dist/${platform}/manifest.json`).version);
  assert.deepEqual(versions, Array(6).fill("0.1.3"));
  assert.ok(read("amo-metadata.json").version.approval_notes.startsWith("Shortener Companion 0.1.3 "));
  const input = {
    event: "push", ref: "refs/tags/extension-v0.1.3", repository: "lucination/shortener",
    ancestor: true, credentials: true, runtimeAccepted: true, attempt: "1",
    versions: [pkg.version, lock.version, lock.packages[""].version, read("dist/firefox/manifest.json").version],
  };
  assert.deepEqual(admit(input), { ok: true, version: "0.1.3" });
  assert.equal(admit({ ...input, attempt: "2" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.0" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.1" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.2" }).ok, false);
});
