import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { admit } from "./publication-policy.mjs";
export function releaseContext(env = process.env) {
  const acceptance = JSON.parse(readFileSync("firefox-acceptance.json"));
  const artifactHash = createHash("sha256")
    .update(readFileSync("dist/firefox.zip"))
    .digest("hex");
  const pkg = JSON.parse(readFileSync("package.json"));
  const lock = JSON.parse(readFileSync("package-lock.json"));
  const manifest = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        'import zipfile;print(zipfile.ZipFile("dist/firefox.zip").read("manifest.json").decode())',
      ],
      { encoding: "utf8" },
    ),
  );
  const ancestor =
    spawnSync("git", [
      "merge-base",
      "--is-ancestor",
      "HEAD",
      "refs/remotes/origin/main",
    ]).status === 0;
  return admit({
    runtimeAccepted:
      acceptance.accepted === true &&
      acceptance.version === pkg.version &&
      acceptance.unsignedZipSha256 === artifactHash,
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
    ancestor,
    versions: [
      pkg.version,
      lock.version,
      lock.packages[""].version,
      manifest.version,
    ],
    credentials: Boolean(
      env.WEB_EXT_API_KEY?.trim() && env.WEB_EXT_API_SECRET?.trim(),
    ),
    attempt: env.GITHUB_RUN_ATTEMPT,
  });
}
