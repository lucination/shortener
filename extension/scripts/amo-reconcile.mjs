import { parseUploadIdentity } from "./amo-read.mjs";
export { createAmoReadOnlyGet } from "./amo-read.mjs";

export const reconciliationGuid = "shortener-companion-v2@shortener.invalid";
const ensure = (value, message) => { if (!value) throw new Error(message); };
export function reconciliationVersion(value) {
  ensure(typeof value === "string" && value.length <= 32 && value === value.trim() && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value), "Invalid reconciliation version; no writes performed");
  return value;
}

function uploadSummary(value, version) {
  const uploadId = parseUploadIdentity(value?.uuid);
  ensure(["listed", "unlisted", "enterprise"].includes(value.channel), "Unexpected upload channel; no writes performed");
  for (const key of ["processed", "valid", "submitted"])
    ensure(typeof value[key] === "boolean", "Unexpected upload status; no writes performed");
  ensure(value.version === null || typeof value.version === "string" && value.version.length <= 255, "Unexpected upload version; no writes performed");
  return { uploadId, channel: value.channel, processed: value.processed, valid: value.valid, submitted: value.submitted, matchesExpectedVersion: value.version === version, versionAvailable: value.version !== null };
}

function nextPage(value, page) {
  if (value === null) return false;
  ensure(typeof value === "string", "Unexpected upload pagination; no writes performed");
  const url = new URL(value);
  ensure(url.origin === "https://addons.mozilla.org" && url.pathname === "/api/v5/addons/upload/" && !url.username && !url.password && !url.hash &&
    [...url.searchParams.keys()].length === 2 && url.searchParams.getAll("page").length === 1 && url.searchParams.getAll("page_size").length === 1 &&
    url.searchParams.get("page") === String(page + 1) && url.searchParams.get("page_size") === "25", "Unexpected upload pagination; no writes performed");
  return true;
}

export async function reconcileAmoUploads({ get, version, uploadId = "", onPhase = () => {} }) {
  reconciliationVersion(version);
  if (uploadId !== "") parseUploadIdentity(uploadId);
  onPhase("publisher-profile");
  const profile = await get("accounts/profile/");
  ensure(profile?.display_name === "Aditya" && Number.isSafeInteger(profile.id) && profile.id > 0, "Publisher identity mismatch; no writes performed");
  const base = `addons/addon/${encodeURIComponent(reconciliationGuid)}/`;
  onPhase("exact-guid-and-version");
  const addon = await get(base, true);
  if (addon) {
    ensure(addon.guid === reconciliationGuid && addon.authors?.some(a => a.id === profile.id && a.name === "Aditya"), "GUID ownership mismatch; no writes performed");
    ensure(typeof addon.is_disabled === "boolean", "Unexpected add-on state; no writes performed");
  }
  const existing = await get(`${base}versions/${encodeURIComponent(version)}/`, true);
  if (existing) ensure(addon && existing.version === version && existing.channel === "listed", "Version identity/channel mismatch; no writes performed");
  const uploads = [];
  const ids = new Set();
  let totalCount;
  let hasMore = false;
  onPhase("bounded-upload-inventory");
  for (let page = 1; page <= 4; page++) {
    const batch = await get(`addons/upload/?page=${page}&page_size=25`);
    ensure(Number.isSafeInteger(batch?.count) && batch.count >= 0 && Array.isArray(batch.results) && batch.results.length <= 25, "Unexpected upload list schema; no writes performed");
    if (totalCount === undefined) totalCount = batch.count;
    ensure(batch.count === totalCount, "Upload inventory changed during reads; no writes performed");
    for (const item of batch.results) {
      const row = uploadSummary(item, version);
      ensure(!ids.has(row.uploadId), "Repeated upload identity during pagination; no writes performed");
      ids.add(row.uploadId); uploads.push(row);
    }
    hasMore = nextPage(batch.next, page);
    ensure(uploads.length <= totalCount && (hasMore ? batch.results.length === 25 && uploads.length < totalCount : uploads.length === totalCount), "Inconsistent upload inventory counts; no writes performed");
    if (!hasMore) break;
  }
  let selectedUpload = null;
  if (uploadId !== "") {
    onPhase("selected-upload-detail");
    const detail = await get(`addons/upload/${uploadId}/`);
    selectedUpload = uploadSummary(detail, version);
    ensure(selectedUpload.uploadId === uploadId, "Selected upload identity mismatch; no writes performed");
  }
  const fileStates = ["public", "unreviewed", "disabled", "awaiting_review", "beta"];
  return {
    guid: reconciliationGuid, version, publisherVerified: true,
    guidLookup: addon ? "owned-record-found" : "not-found-or-not-visible",
    versionLookup: existing ? "exact-listed-version-found" : "not-found-or-not-visible",
    addonDisabled: addon ? addon.is_disabled : null,
    fileStatus: existing ? fileStates.includes(existing.file?.status) ? existing.file.status : "other-provider-state" : null,
    sourceAttached: Boolean(existing?.source),
    uploads, selectedUpload, scannedCount: uploads.length, totalCount, truncated: hasMore,
    ordering: "provider-default; recency not guaranteed by upload API",
    uploadGuidBindingVerified: false, artifactBytesVerified: false,
    resumeAuthorized: false, writesPerformed: 0,
  };
}
