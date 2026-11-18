export const reviewerImage = "ghcr.io/lucination/shortener@sha256:77b47988296ee9dca25f3f4deba84e4fd7064922d8823ca4e6b73a5597266d6a";
export const reviewerServerSha = "783feaa68db35792e3b4b3570f73c4ee56a67113";
export const reviewerChecks = ["immutable-server-image", "admin-create-account", "mailpit-magic-link-signin", "account-create-only-token", "production-extension-request", "emitted-short-url-redirect", "token-revocation", "owned-cleanup"];
export function verifyReviewerSmoke(receipt, expected) {
  return Boolean(receipt && receipt.schema === 1 && receipt.stage === "complete" &&
    receipt.image === reviewerImage && receipt.serverSha === reviewerServerSha &&
    ["sourceSha", "artifactSha256", "sourceArchiveSha256", "runId", "runAttempt"].every(key => receipt[key] === expected[key] && typeof expected[key] === "string" && expected[key].length > 0) &&
    Object.keys(receipt.checks || {}).length === reviewerChecks.length &&
    reviewerChecks.every(key => receipt.checks[key] === "passed"));
}
