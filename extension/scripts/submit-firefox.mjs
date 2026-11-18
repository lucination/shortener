import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { releaseContext } from "./release-context.mjs";
import { createAmoApi, submitListed, validateAsset } from "./amo-listing.mjs";
const context = releaseContext();
if (!context.ok) throw new Error(context.reason);
const manifest = JSON.parse(execFileSync("python3", ["-c", 'import zipfile;print(zipfile.ZipFile("dist/firefox.zip").read("manifest.json").decode())'], { encoding: "utf8" }));
const metadata = JSON.parse(readFileSync("amo-metadata.json"));
const descriptors = JSON.parse(readFileSync("listing/assets.json"));
const assets = descriptors.map(descriptor => {
  if (!/^[a-z-]+\.png$/u.test(descriptor.file)) throw new Error("Invalid approved screenshot path");
  const bytes = readFileSync(`listing/${descriptor.file}`);
  validateAsset(bytes, descriptor);
  return { ...descriptor, filename: descriptor.file, file: new Blob([bytes], { type: "image/png" }) };
});
function token() {
  const b64 = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: process.env.WEB_EXT_API_KEY, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${payload}.${createHmac("sha256", process.env.WEB_EXT_API_SECRET).update(payload).digest("base64url")}`;
}
try {
  const result = await submitListed({
    api: createAmoApi({ token }), metadata, assets,
    guid: manifest.browser_specific_settings.gecko.id, version: context.version,
    artifact: new Blob([readFileSync("dist/firefox.zip")], { type: "application/zip" }),
    source: new Blob([readFileSync("dist/firefox-source.zip")], { type: "application/zip" }),
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  console.error("Stop. Reconcile AMO uploads/add-on/version before any further write. No automatic resume or retry.");
  process.exitCode = 1;
}
