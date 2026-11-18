import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
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

test("0.1.7 Node-26 official-CLI release keeps matching versions and attempt-one admission", () => {
  const read = path => JSON.parse(readFileSync(new URL(path, root)));
  const pkg = read("package.json");
  const lock = read("package-lock.json");
  const versions = [pkg.version, lock.version, lock.packages[""].version];
  for (const platform of ["chrome", "firefox", "safari"])
    versions.push(read(`dist/${platform}/manifest.json`).version);
  assert.deepEqual(versions, Array(6).fill("0.1.7"));
  assert.ok(read("amo-metadata.json").version.approval_notes.startsWith("Shortener Companion 0.1.7 "));
  const input = {
    event: "push", ref: "refs/tags/extension-v0.1.7", repository: "lucination/shortener",
    ancestor: true, credentials: true, runtimeAccepted: true, attempt: "1",
    versions: [pkg.version, lock.version, lock.packages[""].version, read("dist/firefox/manifest.json").version],
  };
  assert.deepEqual(admit(input), { ok: true, version: "0.1.7" });
  assert.equal(admit({ ...input, attempt: "2" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.0" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.1" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.2" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.3" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.4" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.5" }).ok, false);
  assert.equal(admit({ ...input, ref: "refs/tags/extension-v0.1.6" }).ok, false);
});


test("fresh listing package, submit guard, reconciliation and native harness agree on the new stable GUID", async () => {
  const guid = "shortener-companion-v2@shortener.invalid";
  const manifest = JSON.parse(readFileSync(new URL("dist/firefox/manifest.json", root)));
  const packaged = JSON.parse(execFileSync("python3", ["-c", 'import zipfile; print(zipfile.ZipFile("dist/firefox.zip").read("manifest.json").decode())'], { cwd: root, encoding: "utf8" }));
  assert.equal(packaged.browser_specific_settings.gecko.id, guid, "Firefox ZIP must use the new listing identity");
  assert.deepEqual(packaged, manifest, "packaged and directory manifests must match");
  const { reconciliationGuid } = await import("../scripts/amo-reconcile.mjs");
  assert.equal(reconciliationGuid, guid);
  const submit = readFileSync(new URL("scripts/submit-firefox.mjs", root), "utf8");
  const guard = submit.indexOf(`tree.guid!=="${guid}"`);
  assert.ok(guard >= 0, "submission must require the exact new GUID");
  assert.ok(guard < submit.indexOf("new JwtApiAuth"), "identity guard must precede authenticated IO");
  const native = readFileSync(new URL("tests/firefox.mjs", root), "utf8");
  assert.ok(native.includes(`const id = "${guid}";`), "native install and browser harness must target the same listing");
});
