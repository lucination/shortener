import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const workflow = await readFile(
  new URL("../../.github/workflows/firefox.yml", import.meta.url),
  "utf8",
);
test("publication job requires successful verification and canonical trusted tag push", () => {
  const submit = workflow.split("\n  submit:\n")[1];
  assert.match(submit, /needs: \[release-admission, native\]/);
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
  assert.equal(uses.length, 13);
  for (const match of uses) assert.match(match[1], /@[a-f0-9]{40}(?: #|$)/);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 4);
  assert.match(workflow, /node-version: ["']22\.23\.4["']/);
});

test("native execution precedes and is independent of tag admission; no static manual seal", () => {
  const native = workflow
    .split("\n  native:\n")[1]
    .split("\n  release-admission:\n")[0];
  assert.match(native, /needs: verify/);
  assert.doesNotMatch(native, /secrets\.|refs\/tags|firefox-acceptance\.json/);
  assert.match(native, /xvfb-run.*npm run test:firefox/);
  assert.match(native, /runner.temp.*firefox-tools/);
  assert.match(workflow, /release-admission:[^]*needs: \[verify, native\]/);
  assert.doesNotMatch(workflow, /GITHUB_RUN_ATTEMPT:'1'/);
});
test("build artifacts cannot collide across reruns of the same source SHA", () => {
  assert.equal(
    (
      workflow.match(
        /name: firefox-build-\$\{\{ github.sha \}\}-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/g,
      ) || []
    ).length,
    2,
  );
});
