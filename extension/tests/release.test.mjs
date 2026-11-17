import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const root = new URL("../", import.meta.url);
test("extension builds independently of web application dependencies", () => {
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
