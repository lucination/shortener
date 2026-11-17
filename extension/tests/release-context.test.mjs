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
import { releaseContext } from "../scripts/release-context.mjs";
test("real release context binds ancestry, package/lock/ZIP versions, credentials and acceptance hash before effects", () => {
  const original = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), "firefox-admission-"));
  const put = (path, value) => writeFileSync(path, JSON.stringify(value));
  try {
    process.chdir(temp);
    mkdirSync("dist");
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
    put("firefox-acceptance.json", {
      accepted: true,
      version: "0.1.0",
      unsignedZipSha256: hash,
    });
    const env = {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/tags/extension-v0.1.0",
      GITHUB_REPOSITORY: "lucination/shortener",
      GITHUB_RUN_ATTEMPT: "1",
      WEB_EXT_API_KEY: "test-presence",
      WEB_EXT_API_SECRET: "test-presence",
    };
    assert.equal(releaseContext(env).ok, true);
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
    put("firefox-acceptance.json", {
      accepted: true,
      version: "0.1.0",
      unsignedZipSha256: "stale",
    });
    assert.match(releaseContext(env).reason, /native Firefox/);
    put("firefox-acceptance.json", {
      accepted: true,
      version: "0.1.0",
      unsignedZipSha256: hash,
    });
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
