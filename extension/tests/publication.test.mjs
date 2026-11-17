import { test } from "node:test";
import assert from "node:assert/strict";
const policy = await import("../scripts/publication-policy.mjs").catch(() => ({
  admit: () => ({ ok: false, reason: "not implemented" }),
}));
const good = {
  event: "push",
  ref: "refs/tags/extension-v0.1.0",
  repository: "lucination/shortener",
  ancestor: true,
  versions: ["0.1.0", "0.1.0", "0.1.0", "0.1.0"],
  credentials: true,
  attempt: "1",
  runtimeAccepted: true,
};
test("matching main-ancestor release is admitted", () =>
  assert.deepEqual(policy.admit(good), { ok: true, version: "0.1.0" }));
for (const [name, change] of [
  ["malformed tag", { ref: "refs/tags/extension-v01.1.0" }],
  ["prerelease tag", { ref: "refs/tags/extension-v0.1.0-rc1" }],
  ["injected tag", { ref: "refs/tags/extension-v0.1.0;echo pwn" }],
  ["branch", { ref: "refs/heads/main" }],
  ["version mismatch", { versions: ["0.1.0", "0.1.0", "0.1.0", "0.2.0"] }],
  ["untrusted ancestry", { ancestor: false }],
  ["pull request", { event: "pull_request" }],
  ["fork repository", { repository: "fork/shortener" }],
  ["missing credentials", { credentials: false }],
  ["manual bypass", { event: "workflow_dispatch" }],
  ["unknown submit retry", { attempt: "2" }],
])
  test(`rejects ${name}`, () =>
    assert.equal(policy.admit({ ...good, ...change }).ok, false));
test("AMO upload is not a publication; review and anonymous availability are distinct", () => {
  const classify = policy.classify ?? (() => "not implemented");
  assert.equal(classify(null, false), "uploaded-unconfirmed");
  assert.equal(
    classify({ file: { status: "unreviewed" } }, false),
    "in-review",
  );
  assert.equal(
    classify({ file: { status: "public" } }, false),
    "approved-not-publicly-verified",
  );
  assert.equal(classify({ file: { status: "public" } }, true), "published");
  assert.equal(
    classify({ file: { status: "public" }, is_disabled: true }, true),
    "disabled-or-rejected",
  );
});

test("native Firefox acceptance is a release gate, not a documentation-only caveat", () =>
  assert.equal(policy.admit({ ...good, runtimeAccepted: false }).ok, false));
