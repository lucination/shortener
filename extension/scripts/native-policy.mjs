export const nativeChecks = Object.freeze([
  "settings-save",
  "host-grant",
  "native-toolbar",
  "toolbar-icon",
  "active-tab-request",
  "bearer-without-cookie",
  "plain-clipboard",
  "markdown-clipboard",
  "rich-native-clipboard",
  "rich-fallback-clipboard",
  "forget-settings",
]);
export function verifyRuntime(receipt, identity) {
  return Boolean(
    receipt &&
    receipt.schema === 1 &&
    receipt.stage === "complete" &&
    !receipt.error &&
    !receipt.cleanupError &&
    receipt.browserVersion === "160.0.1" &&
    /^[a-f0-9]{64}$/.test(identity.artifactSha256 ?? "") &&
    /^[a-f0-9]{40}$/.test(identity.sourceSha ?? "") &&
    /^\d+$/.test(identity.runId ?? "") &&
    /^[1-9]\d*$/.test(identity.runAttempt ?? "") &&
    ["artifactSha256", "sourceSha", "runId", "runAttempt"].every(
      (k) => receipt[k] === identity[k],
    ) &&
    nativeChecks.every((k) => receipt.checks?.[k] === "passed"),
  );
}
