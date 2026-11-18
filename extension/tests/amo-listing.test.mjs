import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const implementation = await import("../scripts/amo-listing.mjs").catch(() => ({}));

test("AMO listing adapter is implemented", () => {
  assert.equal(typeof implementation.submitListed, "function");
});

function fixture(fault) {
  const calls = [];
  const metadata = { name: { "en-US": "Shortener Companion" }, summary: { "en-US": "summary" }, description: { "en-US": "description" }, categories: { firefox: ["other"] }, privacy_policy: { "en-US": "approved policy" }, version: { license: "all-rights-reserved", approval_notes: "review setup" } };
  let disabled = true;
  const version = { version: "0.1.0", channel: "listed", source: "source.zip", license: { slug: "all-rights-reserved" }, approval_notes: "review setup" };
  const previews = [];
  const api = async (method, path, body) => {
    calls.push([method, path, body]);
    if (fault === path && method !== "GET") throw new Error("uncertain");
    if (path === "accounts/profile/") return { id: 12, display_name: fault === "publisher" ? "Other" : "Aditya", email: "must-not-be-logged@example.invalid" };
    if (path === "addons/addon/test/versions/0.1.0/") return calls.some(c => c[1] === "addons/addon/" && c[0] === "POST") ? version : fault === "existing" ? version : null;
    if (path === "addons/upload/" && method === "POST") return { uuid: "00000000-0000-4000-8000-000000000000" };
    if (path.startsWith("addons/upload/")) return { processed: true, valid: true };
    if (path === "addons/addon/" && method === "POST") return { guid: "test", is_disabled: true };
    if (path.startsWith("addons/addon/test/eula_policy/")) return { privacy_policy: fault === "policy" ? { "en-US": "different" } : metadata.privacy_policy };
    if (path === "addons/addon/test/previews/" && method === "POST") { const p = { id: previews.length + 1, caption: null, position: previews.length, image_size: [1280, 800], image_url: "https://addons.mozilla.org/user-media/preview.png" }; previews.push(p); return p; }
    if (/previews\/\d+\//.test(path) && method === "PATCH") { const p = previews.find(p => path.endsWith(`/${p.id}/`)); p.caption = body.caption; p.position = body.position; return p; }
    if (path === "addons/addon/test/versions/0.1.0/" && method === "PATCH") return version;
    if (path === "addons/addon/test/" && method === "PATCH") { disabled = body.is_disabled; return {}; }
    if (path === "addons/addon/test/") return calls.some(c => c[1] === "addons/addon/" && c[0] === "POST") ? { guid: "test", is_disabled: disabled, name: metadata.name, summary: metadata.summary, description: metadata.description, authors: [{id:12,name:"Aditya"}], previews: fault === "previews" ? [] : previews } : null;
    throw new Error(`Unexpected ${method} ${path}`);
  };
  const input = { api, metadata, guid: "test", version: "0.1.0", artifact: new Blob(["zip"]), source: new Blob(["source"]), assets: [{ file: new Blob(["png"]), filename: "popup.png", caption: { "en-US": "Popup, local address hidden" }, width: 1280, height: 800 }], sleep: async () => {} };
  return { calls, input };
}

test("create atomically disabled; policy, source and screenshot readbacks precede enable", async () => {
  const { calls, input } = fixture();
  await implementation.submitListed(input);
  const create = calls.find(c => c[0] === "POST" && c[1] === "addons/addon/");
  assert.equal(create[2].is_disabled, true);
  assert.equal(create[2].privacy_policy, undefined);
  assert.equal(create[2].version.upload, "00000000-0000-4000-8000-000000000000");
  const policy = calls.find(c => c[0] === "PATCH" && c[1].endsWith("eula_policy/"));
  assert.deepEqual(policy[2], { privacy_policy: input.metadata.privacy_policy });
  const upload = calls.find(c => c[0] === "POST" && c[1].endsWith("previews/"));
  assert.equal(await upload[2].get("image").text(), "png");
  assert.equal(upload[2].get("caption"), null, "AMO multipart previews cannot accept translated captions");
  assert.deepEqual(calls.find(c => c[0] === "PATCH" && c[1].endsWith("previews/1/"))[2], { caption: input.assets[0].caption, position: 0 });
  const enable = calls.findIndex(c => c[0] === "PATCH" && c[2]?.is_disabled === false);
  assert.equal(enable, calls.length - 2);
  assert.ok(calls.slice(0, enable).some(c => c[0] === "GET" && c[1].includes("eula_policy/")));
});

for (const fault of ["publisher", "existing", "policy", "previews", "addons/addon/test/eula_policy/", "addons/addon/test/previews/"]) {
  test(`fails closed without enabling or retrying after ${fault}`, async () => {
    const { calls, input } = fixture(fault);
    await assert.rejects(() => implementation.submitListed(input));
    assert.equal(calls.some(c => c[0] === "PATCH" && c[2]?.is_disabled === false), false);
    const writes = calls.filter(c => c[0] !== "GET");
    assert.equal(new Set(writes.map(c => c[0]+c[1])).size, writes.length);
    if (["publisher", "existing"].includes(fault)) assert.equal(writes.length, 0);
  });
}

test("public listing PNG admission verifies exact bytes, format, dimensions and filename before writes", () => {
  const descriptor = JSON.parse(readFileSync(new URL("../listing/assets.json", import.meta.url)))[0];
  const bytes = readFileSync(new URL(`../listing/${descriptor.file}`, import.meta.url));
  assert.doesNotThrow(() => implementation.validateAsset(bytes, descriptor));
  for (const changed of [{ sha256: "0".repeat(64) }, { width: 1 }, { file: "../private.png" }, { caption: {} }])
    assert.throws(() => implementation.validateAsset(bytes, { ...descriptor, ...changed }));
  assert.throws(() => implementation.validateAsset(Buffer.from("not a PNG"), descriptor));
});

test("HTTP adapter makes exact policy JSON request and rejects uncertain writes without leaking body/auth", async () => {
  let count = 0;
  const api = implementation.createAmoApi({ token: () => "test-auth", fetcher: async (url, init) => {
    count++;
    assert.equal(url, "https://addons.mozilla.org/api/v5/addons/addon/test/eula_policy/");
    assert.equal(init.method, "PATCH"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "JWT test-auth");
    assert.deepEqual(JSON.parse(init.body), { privacy_policy: { "en-US": "approved" } });
    throw new Error("echoed-secret-must-not-escape");
  } });
  await assert.rejects(() => api("PATCH", "addons/addon/test/eula_policy/", { privacy_policy: { "en-US": "approved" } }), error => /outcome unknown/.test(error.message) && !/echoed-secret/.test(error.message));
  assert.equal(count, 1);
});

test("source archive contains exactly the approved public assets and runnable reviewer recipe", () => {
  execFileSync("python3", ["scripts/source-bundle.py"], { cwd: new URL("../", import.meta.url) });
  const entries = JSON.parse(execFileSync("python3", ["-c", 'import zipfile,json; z=zipfile.ZipFile("dist/firefox-source.zip"); print(json.dumps(z.namelist()))'], { cwd: new URL("../", import.meta.url), encoding: "utf8" }));
  assert.deepEqual(entries.filter(p => p.startsWith("extension/listing/")), ["extension/listing/assets.json", "extension/listing/popup.png", "extension/listing/settings.png"]);
  assert.ok(entries.includes("extension/reviewer-compose.yaml"));
  const manifest = readFileSync(new URL("../listing/assets.json", import.meta.url), "utf8");
  assert.doesNotMatch(manifest, /\/home\/|localhost:\d|127\.0\.0\.1|short_at_/);
});
