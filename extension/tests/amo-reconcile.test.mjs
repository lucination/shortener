import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const module = await import("../scripts/amo-reconcile.mjs").catch(() => ({}));
const guid = "shortener-companion@shortener.invalid";
const id = "0123456789abcdef0123456789abcdef";
const upload = { uuid: id, channel: "listed", processed: true, valid: true, submitted: false, version: "0.1.1", validation: { private: "do-not-log" }, url: "https://example.invalid/private?access_token=do-not-log" };

function fixture(change = {}) {
  const calls = [];
  const get = async (path) => {
    calls.push(path);
    if (path === "accounts/profile/") return { id: 7, display_name: "Aditya", email: "do-not-log@example.invalid", ...change.profile };
    if (path.startsWith("addons/addon/")) return path.includes("/versions/") ? change.existing ?? null : change.addon ?? null;
    if (path === `addons/upload/${id}/`) return { ...upload, ...change.upload };
    if (path === "addons/upload/?page=1&page_size=25") return { count: 1, next: null, previous: null, results: [{ ...upload, ...change.upload }], ...change.page };
    throw new Error("Unexpected diagnostic read");
  };
  return { calls, get };
}

test("GET-only reconciliation reports provider IDs/status but cannot assert upload bytes or GUID binding", async () => {
  const { get, calls } = fixture();
  const report = await module.reconcileAmoUploads({ get, version: "0.1.1", uploadId: id });
  assert.equal(report.guid, guid);
  assert.equal(report.version, "0.1.1");
  assert.equal(report.guidLookup, "not-found-or-not-visible");
  assert.equal(report.versionLookup, "not-found-or-not-visible");
  assert.equal(report.uploads[0].uploadId, id);
  assert.equal(report.uploads[0].matchesExpectedVersion, true);
  assert.equal(report.selectedUpload.uploadId, id);
  assert.equal(report.resumeAuthorized, false);
  assert.equal(report.artifactBytesVerified, false);
  assert.equal(report.uploadGuidBindingVerified, false);
  assert.equal(report.scannedCount, 1);
  assert.equal(report.totalCount, 1);
  assert.equal(report.truncated, false);
  assert.doesNotMatch(JSON.stringify(report), /do-not-log|access_token|example\.invalid/);
  assert.ok(calls.every(p => !p.includes("..")));
});

test("reconciliation rejects mismatched publisher, malformed identity and inconsistent pagination without writes", async () => {
  for (const change of [{ profile: { display_name: "Other" } }, { upload: { uuid: "-".repeat(36) } }, { page: { count: 0 } }, { page: { next: "https://attacker.invalid/" } }, { addon: { guid: "wrong" } }, { addon: {guid,authors:[{id:7,name:"Aditya"}],is_disabled:true}, existing: {version:"0.2.0",channel:"listed"} }]) {
    const { get } = fixture(change);
    await assert.rejects(() => module.reconcileAmoUploads({ get, version: "0.1.1" }));
  }
});

test("upload inventory stops at four pages and explicitly reports incomplete coverage", async () => {
  const { get: initialGet } = fixture();
  let pages = 0;
  const get = async path => {
    if (!path.startsWith("addons/upload/?")) return initialGet(path);
    const page = Number(new URL("https://addons.mozilla.org/api/v5/"+path).searchParams.get("page"));
    pages++;
    return {count:150,next:`https://addons.mozilla.org/api/v5/addons/upload/?page=${page+1}&page_size=25`,results:Array.from({length:25},(_,i)=>({...upload,uuid:((page-1)*25+i).toString(16).padStart(32,"0")}))};
  };
  const report = await module.reconcileAmoUploads({get,version:"0.1.1"});
  assert.equal(pages,4);assert.equal(report.scannedCount,100);assert.equal(report.totalCount,150);assert.equal(report.truncated,true);
  assert.match(report.ordering,/recency not guaranteed/);
  assert.equal(report.resumeAuthorized,false);
});

test("invalid diagnostic inputs fail before even the authenticated profile read", async () => {
  for (const input of [{version:"0.1.1\n"},{version:"01.1.1"},{version:"0.1.1",uploadId:"00000000-0000-4000-8000-000000000000"}]) {
    const { get,calls } = fixture();
    await assert.rejects(()=>module.reconcileAmoUploads({get,...input}));
    assert.equal(calls.length,0);
  }
});

test("diagnostic transport has no method/body input and sends only GET", async () => {
  const seen = [];
  const get = module.createAmoReadOnlyGet({ token: () => "test-auth", fetcher: async (url, init) => {
    seen.push([url, init]);
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    return new Response('{}');
  } });
  await get("accounts/profile/");
  assert.equal(seen.length, 1);
});

test("complete diagnostic HTTP codec permits bounded pagination queries and still sends only GET", async () => {
  const { get: model } = fixture();
  const methods = [];
  const get = module.createAmoReadOnlyGet({ token:()=>"test-auth", fetcher:async (url,init)=>{
    methods.push(init.method);assert.equal(init.body,undefined);
    const value = await model(url.slice("https://addons.mozilla.org/api/v5/".length));
    return new Response(JSON.stringify(value ?? {}),{status:value===null?404:200});
  } });
  const report = await module.reconcileAmoUploads({get,version:"0.1.1"});
  assert.ok(methods.length>0&&methods.every(m=>m==="GET"));
  assert.equal(report.scannedCount,1);
  assert.equal(report.resumeAuthorized,false);
});

test("actual diagnostic CLI rejects non-manual invocation before constructing credentials or fetching", () => {
  const result = spawnSync(process.execPath, [new URL("../scripts/reconcile-firefox.mjs",import.meta.url).pathname], {env:{...process.env,GITHUB_EVENT_NAME:"push",GITHUB_REF:"refs/heads/main",GITHUB_REPOSITORY:"lucination/shortener",WEB_EXT_API_KEY:"",WEB_EXT_API_SECRET:""},encoding:"utf8"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/requires canonical main manual dispatch/);
});

test("manual reconciliation is canonical-main-only, credential-isolated and never calls the submit entrypoint", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/firefox-reconcile.yml", import.meta.url), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.repository == 'lucination\/shortener'/);
  assert.match(workflow, /environment: firefox-addons/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /run: node scripts\/reconcile-firefox.mjs/);
  assert.equal((workflow.match(/secrets\./g) || []).length, 2);
  assert.doesNotMatch(workflow, /submit-firefox|web-ext sign|pull_request_target|contents: write|GITHUB_RUN_ATTEMPT/);
  const cli = readFileSync(new URL("../scripts/reconcile-firefox.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /submitListed|submit-firefox|child_process|execFile|spawnSync/);
});
