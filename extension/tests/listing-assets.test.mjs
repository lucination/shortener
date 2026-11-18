import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const root=new URL("../",import.meta.url);
const approvedPolicy="Shortener Companion connects only to the self-hosted Shortener instance you configure. When you shorten a page, its URL and title are sent to that instance using your access token. The instance address and token are stored locally in your browser. The extension developer receives no data or telemetry. Data stored by your instance is under your control.";

test("approved privacy and actual PNG screenshots remain exact, public and bundled for Developer Hub",()=>{
  const policy=readFileSync(new URL("listing/privacy-policy.txt",root),"utf8");assert.equal(policy,approvedPolicy+"\n");
  const assets=JSON.parse(readFileSync(new URL("listing/assets.json",root)));
  assert.deepEqual(assets.map(a=>a.file).sort(),["popup.png","settings.png"]);
  for(const a of assets){
    assert.match(a.file,/^[a-z-]+\.png$/u);const bytes=readFileSync(new URL(`listing/${a.file}`,root));
    assert.equal(createHash("sha256").update(bytes).digest("hex"),a.sha256);
    assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.deepEqual([bytes.readUInt32BE(16),bytes.readUInt32BE(20)],[1280,800]);assert.ok(bytes.length<5*1024*1024);assert.ok(a.caption["en-US"]);
  }
  execFileSync("python3",["scripts/source-bundle.py"],{cwd:root});
  const archived=JSON.parse(execFileSync("python3",["-c",'import zipfile,json; z=zipfile.ZipFile("dist/firefox-source.zip"); print(json.dumps({"listing":[p for p in z.namelist() if p.startswith("extension/listing/")],"policy":z.read("extension/listing/privacy-policy.txt").decode(),"metadata":json.loads(z.read("extension/amo-metadata.json"))}))'],{cwd:root,encoding:"utf8"}));
  assert.deepEqual(archived.listing.sort(),["extension/listing/assets.json","extension/listing/popup.png","extension/listing/privacy-policy.txt","extension/listing/settings.png"].sort());
  assert.equal(archived.policy,policy);assert.equal(archived.metadata.is_disabled,true);assert.equal(archived.metadata.privacy_policy,undefined);
});

test("custom write adapter is removed; release entrypoint delegates once to official CLI",()=>{
  assert.equal(existsSync(new URL("scripts/amo-listing.mjs",root)),false);
  const entry=readFileSync(new URL("scripts/submit-firefox.mjs",root),"utf8");
  assert.match(entry,/releaseContext\(\)/);assert.match(entry,/assertFreshListing/);assert.match(entry,/verifySubmissionTree/);
  assert.equal((entry.match(/await runWebExtSign\(\)/gu)||[]).length,1);
  assert.doesNotMatch(entry,/submitListed|fetch\(|is_disabled: false|"POST"|"PUT"|"PATCH"/u);
});
