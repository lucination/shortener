import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { classify } from "./publication-policy.mjs";
import { releaseContext } from "./release-context.mjs";
const context = releaseContext();
if (!context.ok) throw new Error(context.reason);
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
const guid = manifest.browser_specific_settings.gecko.id;
function token() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: process.env.WEB_EXT_API_KEY, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${payload}.${createHmac("sha256", process.env.WEB_EXT_API_SECRET).update(payload).digest("base64url")}`;
}
async function status() {
  const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(guid)}/versions/${encodeURIComponent(context.version)}/`;
  const response = await fetch(url, {
    headers: { Authorization: `JWT ${token()}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `AMO status HTTP ${response.status}; no submission attempted/retried`,
    );
  const value = await response.json();
  if (value.version !== context.version || value.channel !== "listed")
    throw new Error("AMO version identity/channel mismatch");
  let anonymous = false;
  if (value.file?.status === "public" && !value.is_disabled) {
    const publicRead = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (publicRead.ok) {
      const visible = await publicRead.json();
      anonymous =
        visible.version === context.version &&
        visible.channel === "listed" &&
        visible.file?.status === "public" &&
        !visible.is_disabled;
      if (anonymous) {
        const listingRead = await fetch(
          `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(guid)}/`,
          {
            redirect: "error",
            signal: AbortSignal.timeout(30000),
          },
        );
        const listing = listingRead.ok ? await listingRead.json() : null;
        anonymous =
          listing?.status === "public" &&
          listing.current_version?.version === context.version;
      }
    }
  }
  console.log(
    JSON.stringify({
      version: value.version,
      channel: value.channel,
      file_status: value.file?.status,
      disabled: value.is_disabled,
      source_attached: Boolean(value.source),
      outcome: classify(value, anonymous),
    }),
  );
  return value;
}
if (await status())
  throw new Error(
    "Version already exists. No duplicate submission. Inspect AMO before any action.",
  );
let failed = false;
try {
  // No retry: web-ext uploads a listed version and matching source. Zero approval
  // wait means acceptance here is upload/submission, never publication.
  execFileSync(
    process.execPath,
    [
      "node_modules/web-ext/bin/web-ext.js",
      "sign",
      "--source-dir",
      "dist/firefox",
      "--channel",
      "listed",
      "--amo-base-url",
      "https://addons.mozilla.org/api/v5/",
      "--amo-metadata",
      "amo-metadata.json",
      "--upload-source-code",
      "dist/firefox-source.zip",
      "--approval-timeout",
      "0",
      "--no-config-discovery",
      "--no-input",
    ],
    { stdio: "inherit" },
  );
  console.log("Uploaded/submitted to listed channel; NOT a publication claim.");
} catch {
  failed = true;
  console.error(
    "Submission outcome uncertain. Do not retry; inspect AMO uploads and versions.",
  );
}
const observed = await status();
if (!observed?.source || failed)
  throw new Error("Reconcile AMO Developer Hub before another submission.");
