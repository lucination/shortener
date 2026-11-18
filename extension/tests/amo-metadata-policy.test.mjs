import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const policy=await import("../scripts/amo-metadata-policy.mjs").catch(()=>({}));
const metadata=JSON.parse(readFileSync(new URL("../amo-metadata.json",import.meta.url)));

test("provider approval_notes limit is 3000 Unicode code points with max-minus/max/max-plus boundaries",()=>{
  assert.equal(policy.approvalNotesMaxLength,3000);
  for(const count of [2999,3000]) assert.equal(policy.validateAmoMetadata({version:{approval_notes:"x".repeat(count)}}).approvalNotesCharacters,count);
  assert.throws(()=>policy.validateAmoMetadata({version:{approval_notes:"x".repeat(3001)}}),error=>error.diagnostic.codes.includes("max_length")&&error.diagnostic.actualLength===3001);
  assert.equal(policy.validateAmoMetadata({version:{approval_notes:"😀".repeat(3000)}}).approvalNotesCharacters,3000);
  assert.throws(()=>policy.validateAmoMetadata({version:{approval_notes:"😀".repeat(3001)}}));
});

test("approval_notes client admission requires a primitive string and never echoes content",()=>{
  for(const notes of [undefined,null,{},[],true,42,new String("notes")])
    assert.throws(()=>policy.validateAmoMetadata({version:{approval_notes:notes}}));
  assert.throws(()=>policy.validateAmoMetadata({version:{approval_notes:"private@example.invalid".repeat(200)}}),error=>{
    assert.deepEqual(error.diagnostic.fields,["version.approval_notes"]);
    assert.doesNotMatch(JSON.stringify(error.diagnostic)+error.message,/private@/);
    return true;
  });
});

test("current checked-in approval_notes must pass actual provider length admission before any release",()=>{
  assert.doesNotThrow(()=>policy.validateAmoMetadata(metadata));
});

test("metadata admission runs before publisher reads/CLI and in the secret-free verify job",()=>{
  const entry=readFileSync(new URL("../scripts/submit-firefox.mjs",import.meta.url),"utf8");
  const call=entry.indexOf("validateAmoMetadata(metadata)");assert.ok(call>0);
  assert.ok(call<entry.indexOf("await assertFreshListing"));
  assert.ok(call<entry.indexOf("await runWebExtSign"));
  const workflow=readFileSync(new URL("../../.github/workflows/firefox.yml",import.meta.url),"utf8");
  assert.match(workflow,/run: node scripts\/check-amo-metadata\.mjs && npm run check && npm test/);
});
