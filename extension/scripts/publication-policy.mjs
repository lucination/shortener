/** Pure release admission. Credentials are represented only by presence. */
export function admit(input) {
  const version =
    /^refs\/tags\/extension-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
      .exec(input.ref ?? "")
      ?.slice(1)
      .join(".");
  if (input.repository !== "lucination/shortener" || input.event !== "push")
    return { ok: false, reason: "untrusted event or repository" };
  if (!version) return { ok: false, reason: "invalid release tag" };
  if (!input.ancestor)
    return { ok: false, reason: "release is not an ancestor of main" };
  if (
    input.versions.length !== 4 ||
    input.versions.some((value) => value !== version)
  )
    return {
      ok: false,
      reason: "package, lock and manifest versions must match tag",
    };
  if (input.runtimeAccepted !== true)
    return {
      ok: false,
      reason:
        "native Firefox popup/clipboard acceptance is pending for this artifact",
    };
  if (!input.credentials)
    return {
      ok: false,
      reason: "WEB_EXT_API_KEY and WEB_EXT_API_SECRET are required",
    };
  if (input.attempt !== "1")
    return {
      ok: false,
      reason:
        "retry requires AMO status reconciliation; automatic resubmission blocked",
    };
  return { ok: true, version };
}
/** AMO API v5 file states; only anonymous exact-version readback proves public. */
export function classify(version, anonymouslyAvailable) {
  if (!version) return "uploaded-unconfirmed";
  if (version.is_disabled || version.file?.status === "disabled")
    return "disabled-or-rejected";
  if (version.file?.status === "unreviewed") return "in-review";
  if (version.file?.status === "public")
    return anonymouslyAvailable
      ? "published"
      : "approved-not-publicly-verified";
  return "uploaded-unconfirmed";
}
