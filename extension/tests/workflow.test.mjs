import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const workflow = await readFile(
  new URL("../../.github/workflows/firefox.yml", import.meta.url),
  "utf8",
);
test("reviewer-setup feature branch runs secret-free verification and native acceptance on push", () => {
  assert.match(workflow, /branches: \[main, feat\/firefox-publication, docs\/firefox-reviewer-setup\]/);
});
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
});

test("native execution precedes and is independent of tag admission; no static manual seal", () => {
  const native = workflow
    .split("\n  native:\n")[1]
    .split("\n  release-admission:\n")[0];
  assert.match(native, /needs: verify/);
  assert.doesNotMatch(native, /secrets\.|refs\/tags|firefox-acceptance\.json/);
  assert.match(native, /xvfb-run.*npm run test:firefox/);
  assert.match(native, /node scripts\/reviewer-smoke.mjs/);
  assert.match(native, /node node_modules\/typescript\/bin\/tsc -p tsconfig.json/);
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


function assertPinnedJobs(text, expectedJobs) {
  const jobs = text.split("\njobs:\n")[1].split(/(?=^  [a-z][\w-]*:\n)/m).filter(job => /^  [a-z][\w-]*:\n/u.test(job));
  assert.deepEqual(jobs.map(job => /^  ([\w-]+):/u.exec(job)[1]), expectedJobs);
  for (const job of jobs) {
    const name = /^  ([\w-]+):/u.exec(job)[1];
    assert.equal([...job.matchAll(/uses: actions\/setup-node@/gu)].length, 1, `${name} must have one explicit Node setup`);
    const pins = [...job.matchAll(/^\s+node-version: ["']([^"']+)["']\s*$/gmu)].map(match => match[1]);
    assert.deepEqual(pins, ["26.13.1"], `${name} must use the exact approved Firefox Node runtime`);
  }
}

test("every Firefox publication job pins the approved Node 26.13.1 runtime", () => {
  assertPinnedJobs(workflow, ["verify", "native", "release-admission", "submit"]);
});

test("read-only reconciliation pins the same approved Node 26.13.1 runtime", async () => {
  const reconcile = await readFile(new URL("../../.github/workflows/firefox-reconcile.yml", import.meta.url), "utf8");
  assertPinnedJobs(reconcile, ["reconcile"]);
});

test("source reproduction docs declare the matching Node and npm versions", async () => {
  const publication = await readFile(new URL("../FIREFOX-PUBLICATION.md", import.meta.url), "utf8");
  assert.ok(publication.includes("Node **26.13.1**, npm **11.20.0**"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes("Node 26.13.1, npm 11.20.0"));
});
