import { test } from "node:test";
import assert from "node:assert/strict";
const api = await import("../scripts/native-policy.mjs").catch(() => ({
  verifyRuntime: () => false,
}));
const identity = {
  artifactSha256: "a".repeat(64),
  sourceSha: "b".repeat(40),
  runId: "123",
  runAttempt: "1",
};
const checks = [
  "settings-save",
  "host-grant",
  "native-toolbar",
  "active-tab-request",
  "bearer-without-cookie",
  "plain-clipboard",
  "rich-native-clipboard",
  "rich-fallback-clipboard",
  "forget-settings",
];
const receipt = {
  schema: 1,
  stage: "complete",
  ...identity,
  browserVersion: "160.0.1",
  checks: Object.fromEntries(checks.map((k) => [k, "passed"])),
};
test("same-run native receipt admits only complete observed checks bound to exact source/artifact", () =>
  assert.equal(api.verifyRuntime(receipt, identity), true));
for (const key of ["artifactSha256", "sourceSha", "runId", "runAttempt"])
  test(`rejects stale ${key}`, () =>
    assert.equal(
      api.verifyRuntime({ ...receipt, [key]: "stale" }, identity),
      false,
    ));
for (const key of checks)
  test(`rejects missing ${key}`, () =>
    assert.equal(
      api.verifyRuntime(
        { ...receipt, checks: { ...receipt.checks, [key]: "pending" } },
        identity,
      ),
      false,
    ));
test("rejects missing receipt, legacy static accepted boolean and unpinned browser", () => {
  assert.equal(api.verifyRuntime(null, identity), false);
  assert.equal(
    api.verifyRuntime(
      { accepted: true, unsignedZipSha256: identity.artifactSha256 },
      identity,
    ),
    false,
  );
  assert.equal(
    api.verifyRuntime({ ...receipt, browserVersion: "unverified" }, identity),
    false,
  );
});
test("failed cleanup or incomplete stage cannot admit even a full prior check map", () => {
  assert.equal(
    api.verifyRuntime(
      { ...receipt, stage: "failed", error: "post-check failure" },
      identity,
    ),
    false,
  );
  assert.equal(
    api.verifyRuntime({ ...receipt, error: "late failure" }, identity),
    false,
  );
  assert.equal(
    api.verifyRuntime({ ...receipt, cleanupError: "quit failed" }, identity),
    false,
  );
});
