import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAmoReadOnlyGet } from "../scripts/amo-read.mjs";

const sensitive = "private-person@example.invalid private-token private-profile-id";
const profile = { id: 7, display_name: "Aditya" };
const guid = "shortener-companion-v2@shortener.invalid";
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url))).version;
const owned = { guid, authors: [{ id: 7, name: "Aditya" }], is_disabled: true };
const scenarios = [
  ["name", { profile: { id: 7, display_name: sensitive } }, "publisher_display_name_mismatch", "publisher-profile", { expectedNameMatches: false, publisherIdValid: true }],
  ["id", { profile: { id: sensitive, display_name: "Aditya" } }, "publisher_id_invalid", "publisher-profile", { expectedNameMatches: true, publisherIdValid: false }],
  ["owner", { addon: { ...owned, authors: [{ id: 8, name: sensitive }] } }, "guid_owned_by_other", "exact-guid-and-version"],
  ["guid", { addon: { ...owned, guid: sensitive } }, "guid_identity_mismatch", "exact-guid-and-version"],
  ["addon-schema", { addon: { ...owned, authors: sensitive } }, "addon_schema_invalid", "exact-guid-and-version"],
  ["state", { addon: { ...owned, is_disabled: sensitive } }, "addon_state_invalid", "exact-guid-and-version"],
  ["version", { addon: owned, existing: { version: sensitive, channel: "listed" } }, "existing_version_mismatch", "exact-guid-and-version"],
  ["schema", { page: { count: sensitive, results: [] } }, "upload_schema_invalid", "bounded-upload-inventory"],
  ["transport", { transport: true }, "get_transport_failed", "publisher-profile"],
  ["http", { status: 403 }, "get_http_error", "publisher-profile"],
  ["body", { malformed: true }, "response_unreadable", "publisher-profile"],
];

const runs = scenarios.map(scenario => ["reconcile", ...scenario]).concat(
  scenarios.filter(([name]) => ["name", "id", "transport", "http", "body"].includes(name)).map(scenario => ["submit", ...scenario]),
  [["submit", "existing-version", { existing: {} }, "existing_version", "exact-guid-and-version"],
   ["submit", "existing-guid", { addon: {} }, "existing_guid", "exact-guid-and-version"]],
);
for (const [entry, name, change, failureCode, phase, publisherChecks] of runs) test(`actual ${entry} CLI classifies ${name} without leaking provider values`, () => {
  const dir = mkdtempSync(join(homedir(), ".cache/amo-diagnostic-"));
  try {
    const callsFile = join(dir, "calls.jsonl");
    const preload = join(dir, "fixture.mjs");
    // Synthetic provider fixture, never a live response. Production entrypoint,
    // JWT generation, GET transport adapter, policy and catch are all executed.
    writeFileSync(preload, `import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";
// Submit-catch fixture only: isolate preflight from unrelated release receipts.
// No native/reviewer receipt is created or accepted by this test.
if (process.env.AMO_DIAGNOSTIC_ENTRY === "submit") registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/scripts/release-context.mjs")) return {format:"module",shortCircuit:true,source:'export function releaseContext(){return {ok:true,version:${JSON.stringify(version)}};}'};
    const loaded = nextLoad(url, context);
    // Fence the writer even if a future regression wrongly admits this fixture.
    if (url.endsWith("/scripts/web-ext-release.mjs")) return { ...loaded, source: loaded.source.toString() + '\\nrunWebExtSign = () => { throw new Error("Synthetic fixture forbids CLI invocation"); };' };
    return loaded;
  }
});
const fixture = JSON.parse(process.env.AMO_DIAGNOSTIC_FIXTURE);
globalThis.fetch = async (url, init) => {
  appendFileSync(process.env.AMO_DIAGNOSTIC_CALLS, JSON.stringify({method:init.method,bodyPresent:init.body!==undefined})+"\\n");
  if (fixture.transport) throw new Error(${JSON.stringify(sensitive)});
  if (fixture.status) return new Response(${JSON.stringify(sensitive)}, {status:fixture.status});
  if (fixture.malformed) return new Response(${JSON.stringify(sensitive)});
  const path = new URL(url).pathname;
  const value = path.endsWith("accounts/profile/") ? fixture.profile
    : path.includes("/versions/") ? fixture.existing
    : path.includes("/addons/addon/") ? fixture.addon
    : fixture.page;
  return new Response(JSON.stringify(value ?? {}), {status:value===null?404:200});
};`);
    const fixture = { profile, addon: null, existing: null, page: { count: 0, next: null, results: [] }, ...change };
    const result = spawnSync(process.execPath, ["--import", preload, new URL(`../scripts/${entry === "submit" ? "submit" : "reconcile"}-firefox.mjs`, import.meta.url).pathname], {
      encoding: "utf8", timeout: 5000, cwd: new URL("../", import.meta.url),
      env: { PATH: process.env.PATH, HOME: homedir(), GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "lucination/shortener", WEB_EXT_API_KEY: "synthetic-key", WEB_EXT_API_SECRET: "synthetic-secret", AMO_RECONCILE_VERSION: version, AMO_DIAGNOSTIC_ENTRY: entry, AMO_DIAGNOSTIC_FIXTURE: JSON.stringify(fixture), AMO_DIAGNOSTIC_CALLS: callsFile },
    });
    assert.equal(result.status, 1, result.stderr);
    const diagnostic = JSON.parse(result.stderr.trim());
    assert.equal(diagnostic.failureCode, failureCode);
    assert.equal(diagnostic.phase, phase);
    assert.equal(diagnostic.httpStatus, change.status ?? null);
    if (entry === "reconcile") assert.equal(diagnostic.writesPerformed, 0);
    else { assert.equal(diagnostic.stage, "preflight"); assert.equal(diagnostic.outcome, "stopped"); }
    if (publisherChecks) assert.deepEqual(diagnostic.publisherChecks, publisherChecks);
    assert.doesNotMatch(result.stdout + result.stderr, /private-person|private-token|private-profile-id|synthetic-key|synthetic-secret/);
    const calls = readFileSync(callsFile, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(calls.every(c => c.method === "GET" && !c.bodyPresent));
    if (["transport", "http", "body", "name", "id"].includes(name)) assert.equal(calls.length, 1, "no retry after failure");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("GET adapter distinguishes token generation exception from transport without leaking it", async () => {
  let fetches = 0;
  const get = createAmoReadOnlyGet({ token: () => { throw new Error(sensitive); }, fetcher: async () => { fetches++; } });
  await assert.rejects(() => get("accounts/profile/"), error => {
    assert.equal(error.message, "AMO GET token generation failed; stop and inspect access");
    assert.doesNotMatch(error.stack, /private-person|private-token/);
    return true;
  });
  assert.equal(fetches, 0);
});

test("diagnostic mapper copies only exact local allowlist classes; unknown errors stay unknown", async () => {
  const { amoFailureDiagnostic } = await import("../scripts/amo-diagnostics.mjs").catch(() => ({}));
  assert.equal(typeof amoFailureDiagnostic, "function");
  assert.deepEqual(amoFailureDiagnostic(new Error(sensitive)), { failureCode: "unknown", httpStatus: null });
  assert.deepEqual(amoFailureDiagnostic(new Error("AMO GET HTTP 403; stop and reconcile, do not retry")), { failureCode: "get_http_error", httpStatus: 403 });
  assert.deepEqual(amoFailureDiagnostic(new Error("AMO GET HTTP 403; " + sensitive)), { failureCode: "unknown", httpStatus: null });
});
