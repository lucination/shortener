import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const workflow = await readFile(
  new URL("../../.github/workflows/firefox.yml", import.meta.url),
  "utf8",
);
test("publication job requires successful verification and canonical trusted tag push", () => {
  const submit = workflow.split("\n  submit:\n")[1];
  assert.match(submit, /needs: verify/);
  assert.match(
    submit,
    /if: github.event_name == 'push' && startsWith\(github.ref, 'refs\/tags\/extension-v'\) && github.repository == 'lucination\/shortener'/,
  );
  assert.match(submit, /environment: firefox-addons/);
  assert.doesNotMatch(
    workflow,
    /pull_request_target|secrets: inherit|contents: write/,
  );
  assert.equal((workflow.match(/secrets\./g) || []).length, 2);
  assert.equal(
    (workflow.split("\n  submit:\n")[0].match(/secrets\./g) || []).length,
    0,
  );
  assert.match(
    submit,
    /name: Submit listed Firefox version[^]*env:[^]*WEB_EXT_API_KEY:[^]*WEB_EXT_API_SECRET:[^]*run: node scripts\/submit-firefox.mjs/,
  );
});
test("actions immutable and GitHub credentials not persisted", () => {
  const uses = [...workflow.matchAll(/uses: ([^\n]+)/g)];
  assert.equal(uses.length, 6);
  for (const match of uses) assert.match(match[1], /@[a-f0-9]{40}(?: #|$)/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 2);
  assert.match(workflow, /node-version: ["']22\.23\.4["']/);
});
