import { createHmac, randomUUID } from "node:crypto";
import { createAmoReadOnlyGet, reconcileAmoUploads } from "./amo-reconcile.mjs";

// Separate read-only capability, never an admission exception for submission.
if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" || process.env.GITHUB_REF !== "refs/heads/main" || process.env.GITHUB_REPOSITORY !== "lucination/shortener")
  throw new Error("Read-only reconciliation requires canonical main manual dispatch");
if (!process.env.WEB_EXT_API_KEY?.trim() || !process.env.WEB_EXT_API_SECRET?.trim())
  throw new Error("Protected environment API credentials are required for read-only reconciliation");
function token() {
  const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: process.env.WEB_EXT_API_KEY, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${payload}.${createHmac("sha256", process.env.WEB_EXT_API_SECRET).update(payload).digest("base64url")}`;
}
try {
  const report = await reconcileAmoUploads({ get: createAmoReadOnlyGet({ token }), version: process.env.AMO_RECONCILE_VERSION, uploadId: process.env.AMO_RECONCILE_UPLOAD_ID || "", onPhase: phase => console.log(JSON.stringify({ readOnly: true, phase })) });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const status = error instanceof Error ? /^AMO GET HTTP ([1-5]\d{2});/u.exec(error.message)?.[1] : undefined;
  console.error(JSON.stringify({ error: "Read-only AMO reconciliation failed or its bounded contract was not satisfied", httpStatus: status ? Number(status) : null, writesPerformed: 0, instruction: "Inspect protected operator access; do not upload or retry submission" }));
  process.exitCode = 1;
}
