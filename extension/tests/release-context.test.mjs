import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { nativeChecks } from "../scripts/native-policy.mjs";
import { releaseContext } from "../scripts/release-context.mjs";
test("real release context binds ancestry, package/lock/ZIP versions, credentials and acceptance hash before effects", () => {
  const original = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), "firefox-admission-"));
  const put = (path, value) => writeFileSync(path, JSON.stringify(value));
  try {
    process.chdir(temp);
    mkdirSync("dist/native", { recursive: true });
    writeFileSync("dist/firefox-source.zip", "test source archive");
    execFileSync("git", ["init", "-q"]);
    execFileSync("git", [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    ]);
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    put("package.json", { version: "0.1.0" });
    put("package-lock.json", {
      version: "0.1.0",
      packages: { "": { version: "0.1.0" } },
    });
    execFileSync("python3", [
      "-c",
      'import zipfile,json; z=zipfile.ZipFile("dist/firefox.zip","w");z.writestr("manifest.json",json.dumps({"version":"0.1.0"}));z.close()',
    ]);
    const hash = createHash("sha256")
      .update(readFileSync("dist/firefox.zip"))
      .digest("hex");
    const receipt = {
      schema: 1,
      stage: "complete",
      artifactSha256: hash,
      sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      runId: "123",
      runAttempt: "1",
      browserVersion: "160.0.1",
      checks: Object.fromEntries(nativeChecks.map((k) => [k, "passed"])),
    };
    put("dist/native/firefox-runtime.json", receipt);
    const reviewerReceipt = {
      schema: 1, stage: "complete", sourceSha: receipt.sourceSha,
      artifactSha256: hash, runId: "123", runAttempt: "1",
      sourceArchiveSha256: createHash("sha256").update("test source archive").digest("hex"),
      image: "ghcr.io/lucination/shortener@sha256:77b47988296ee9dca25f3f4deba84e4fd7064922d8823ca4e6b73a5597266d6a",
      serverSha: "783feaa68db35792e3b4b3570f73c4ee56a67113",
      checks: Object.fromEntries(["immutable-server-image", "admin-create-account", "mailpit-magic-link-signin", "account-create-only-token", "production-extension-request", "emitted-short-url-redirect", "token-revocation", "owned-cleanup"].map(k => [k, "passed"])),
    };
    put("dist/native/reviewer-smoke.json", reviewerReceipt);
    const env = {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/tags/extension-v0.1.0",
      GITHUB_REPOSITORY: "lucination/shortener",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_RUN_ID: "123",
      WEB_EXT_API_KEY: "test-presence",
      WEB_EXT_API_SECRET: "test-presence",
    };
    assert.equal(releaseContext(env).ok, true);
    put("dist/native/reviewer-smoke.json", { ...reviewerReceipt, sourceArchiveSha256: "stale" });
    assert.match(releaseContext(env).reason, /reviewer/);
    put("dist/native/reviewer-smoke.json", reviewerReceipt);
    put("dist/native/reviewer-smoke.json", { ...reviewerReceipt, artifactSha256: "stale" });
    assert.match(releaseContext(env).reason, /reviewer/);
    put("dist/native/reviewer-smoke.json", { ...reviewerReceipt, stage: "failed" });
    assert.match(releaseContext(env).reason, /reviewer/);
    put("dist/native/reviewer-smoke.json", reviewerReceipt);
    assert.match(
      releaseContext({ ...env, WEB_EXT_API_SECRET: "" }).reason,
      /required/,
    );
    assert.match(
      releaseContext({ ...env, GITHUB_REF: "refs/tags/extension-v0.2.0" })
        .reason,
      /versions/,
    );
    assert.match(
      releaseContext({ ...env, GITHUB_EVENT_NAME: "pull_request" }).reason,
      /untrusted/,
    );
    put("dist/native/firefox-runtime.json", {
      ...receipt,
      artifactSha256: "stale",
    });
    assert.match(releaseContext(env).reason, /native Firefox/);
    put("dist/native/firefox-runtime.json", receipt);
    assert.match(releaseContext({ ...env, GITHUB_RUN_ID: "different-run" }).reason, /reviewer/);
    put("dist/native/reviewer-smoke.json", { ...reviewerReceipt, runId: "different-run" });
    assert.match(
      releaseContext({ ...env, GITHUB_RUN_ID: "different-run" }).reason,
      /native Firefox/,
    );
    put("dist/native/reviewer-smoke.json", reviewerReceipt);
    // Actual CLI fails without credentials before it can construct a JWT or fetch.
    const cli = spawnSync(
      process.execPath,
      [new URL("../scripts/submit-firefox.mjs", import.meta.url).pathname],
      {
        env: {
          ...process.env,
          ...env,
          WEB_EXT_API_KEY: "",
          WEB_EXT_API_SECRET: "",
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(cli.status, 0);
    assert.match(
      cli.stderr,
      /WEB_EXT_API_KEY and WEB_EXT_API_SECRET are required/,
    );
    execFileSync("git", ["update-ref", "-d", "refs/remotes/origin/main"]);
    assert.match(releaseContext(env).reason, /ancestor/);
  } finally {
    process.chdir(original);
    rmSync(temp, { recursive: true, force: true });
  }
});
