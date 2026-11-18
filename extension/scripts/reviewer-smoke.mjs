import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createLink } from "../compiled/extension/src/api.js";
import { prepareCreation, shortAddress } from "../compiled/extension/src/core.js";
import { reviewerImage as image, reviewerServerSha as serverSha } from "./reviewer-policy.mjs";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.RUNNER_OS !== "Linux")
  throw new Error("Reviewer Docker smoke is admitted only on the secret-free Linux hosted runner");
const evidence = process.env.EXTENSION_EVIDENCE || "dist/native";
await mkdir(evidence, { recursive: true });
const name = "reviewer-" + randomUUID();
const env = { ...process.env, ADMIN_TOKEN: randomBytes(32).toString("hex"), ANALYTICS_SECRET: randomBytes(32).toString("hex") };
const compose = (...args) => execFileSync("docker", ["compose", "--project-name", name, "-f", "reviewer-compose.yaml", ...args], { env, stdio: ["ignore", "pipe", "pipe"], timeout: 240000 }).toString();
const receipt = { schema: 1, stage: "started", sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim(), artifactSha256: createHash("sha256").update(await readFile("dist/firefox.zip")).digest("hex"), runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, image, serverSha, checks: {} };
const pass = key => { receipt.checks[key] = "passed"; console.log(`Reviewer smoke: ${key}`); };
receipt.sourceArchiveSha256 = createHash("sha256").update(await readFile("dist/firefox-source.zip")).digest("hex");
const origin = "http://localhost";
const request = (path, options = {}) => fetch(new URL(path, origin), { ...options, redirect: "manual", signal: AbortSignal.timeout(10000) });
const post = (path, body, cookie) => request(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const cookie = (response, name) => { const item = response.headers.getSetCookie().find(s => s.startsWith(name + "=")); assert.ok(item, "Missing expected session cookie"); return item.split(";")[0]; };
try {
  compose("config", "--quiet");
  compose("up", "-d", "--wait", "--wait-timeout", "120");
  const inspect = JSON.parse(execFileSync("docker", ["image", "inspect", image], {encoding:"utf8"}))[0];
  assert.equal(inspect.Config.Labels["org.opencontainers.image.revision"], serverSha);
  pass("immutable-server-image");
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/_/")).status, 200);
  const admin = await post("/_/api/login", { token: env.ADMIN_TOKEN }); assert.equal(admin.status, 200);
  const adminCookie = cookie(admin, "short_admin");
  const email = "reviewer@example.test"; // Disposable Mailpit-only identity, never a real mailbox.
  assert.equal((await post("/_/api/users", { email, retention_days: null, link_quota: null }, adminCookie)).status, 201);
  pass("admin-create-account");
  assert.equal((await post("/api/auth/magic-link", {email})).status, 200);
  let message;
  for (let i = 0; i < 30; i++) {
    const mail = await fetch("http://127.0.0.1:8025/api/v1/messages", {signal:AbortSignal.timeout(5000)});
    assert.equal(mail.status, 200);
    const data = await mail.json();
    if (data.messages?.length === 1) { message = data.messages[0]; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(message, "Mailpit must capture the sign-in email");
  const body = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${encodeURIComponent(message.ID)}`, {signal:AbortSignal.timeout(5000)})).json();
  const match = body.Text?.match(/http:\/\/localhost\/auth\/verify\?token=[A-Za-z0-9_-]+/u);
  assert.ok(match, "Captured mail must contain a loopback sign-in URL");
  const signedIn = await request(match[0]); assert.equal(signedIn.status, 303);
  const userCookie = cookie(signedIn, "short_session");
  pass("mailpit-magic-link-signin");
  const issued = await post("/api/account/tokens", {name:"Firefox review",expires_in_days:90}, userCookie);
  assert.equal(issued.status, 201); const credential = await issued.json();
  assert.match(credential.token, /^short_at_[0-9a-f]{64}$/u);
  pass("account-create-only-token");
  const prepared = prepareCreation({ service: origin, token: credential.token }, {url:origin + "/",title:"Shortener reviewer setup"});
  // Actual shipped production request adapter against the real native server;
  // no fixture response, fetch interception, DB injection or reconstructed API.
  const created = await createLink(prepared.settings, prepared.input);
  const short = shortAddress(created, origin);
  assert.equal(new URL(short).origin, origin);
  pass("production-extension-request");
  const redirect = await request(short); assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), origin + "/");
  pass("emitted-short-url-redirect");
  const revoke = await request(`/api/account/tokens/${credential.metadata.id}`, {method:"DELETE",headers:{Origin:origin,Cookie:userCookie}});
  assert.equal(revoke.status, 200);
  await assert.rejects(() => createLink(prepared.settings, prepared.input), /not accepted/);
  pass("token-revocation");
  receipt.stage = "complete";
} catch {
  // Never persist provider bodies, email contents, tokens or command stderr.
  receipt.stage = "failed";
  process.exitCode = 1;
  console.error("Reviewer smoke failed; inspect assertion stages, no credentials or provider output retained");
} finally {
  try { compose("down", "--volumes", "--remove-orphans"); pass("owned-cleanup"); }
  catch { receipt.stage = "failed"; process.exitCode = 1; }
  await writeFile(`${evidence}/reviewer-smoke.json`, JSON.stringify(receipt,null,2)+"\n");
}
