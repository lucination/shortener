import { isDeepStrictEqual as equal } from "node:util";
import { createHash } from "node:crypto";

const requireValue = (value, message) => { if (!value) throw new Error(message); };
const same = (actual, expected, label) => requireValue(equal(actual, expected), `AMO ${label} readback mismatch; reconcile, do not retry`);
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export function validateAsset(bytes, descriptor) {
  requireValue(/^[a-z-]+\.png$/u.test(descriptor.file), "Invalid public screenshot filename");
  requireValue(bytes.length >= 33 && bytes.length < 5 * 1024 * 1024 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "Screenshot must be a bounded PNG");
  same(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256, "approved screenshot SHA256");
  same([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [descriptor.width, descriptor.height], "approved screenshot dimensions");
  requireValue(descriptor.width === 1280 && descriptor.height === 800 && descriptor.caption?.["en-US"], "Approved screenshot dimensions/caption required");
}

// All writes are single-attempt. Only asynchronous validation/media GETs poll.
// A new add-on is atomically developer-disabled, so review/auto-approval cannot
// make it public before policy, source and all screenshots have been verified.
export async function submitListed({ api, metadata, assets, artifact, source, guid, version, sleep = pause }) {
  requireValue(assets?.length > 0 && assets.length <= 10, "Approved screenshots required before any AMO write");
  requireValue(metadata.privacy_policy?.["en-US"] && metadata.name?.["en-US"] && metadata.version?.license && source && artifact, "Incomplete approved listing inputs");
  const base = `addons/addon/${encodeURIComponent(guid)}/`;
  const versionPath = `${base}versions/${encodeURIComponent(version)}/`;
  const profile = await api("GET", "accounts/profile/");
  requireValue(profile.display_name === "Aditya" && Number.isSafeInteger(profile.id), "Authenticated publisher does not match approved display name; no writes attempted");
  requireValue(!(await api("GET", versionPath, undefined, true)), "Version already exists; inspect AMO, do not retry");
  requireValue(!(await api("GET", base, undefined, true)), "Add-on already exists; new-listing transaction cannot resume automatically");
  const uploadForm = new FormData();
  uploadForm.set("channel", "listed");
  uploadForm.set("upload", artifact, "firefox.zip");
  const upload = await api("POST", "addons/upload/", uploadForm);
  requireValue(/^[0-9a-f-]{36}$/u.test(upload.uuid), "Invalid AMO upload identity; reconcile, do not retry");
  let valid = false;
  for (let i = 0; i < 60; i++) {
    const observed = await api("GET", `addons/upload/${upload.uuid}/`);
    if (observed.processed) {
      requireValue(observed.valid === true, "AMO validation rejected upload; no version created");
      valid = true; break;
    }
    await sleep(5000);
  }
  requireValue(valid, "AMO validation timed out; reconcile upload, do not retry");
  const { privacy_policy: policy, version: versionMetadata, ...listing } = metadata;
  // Do not forward unsupported privacy_policy to the add-on create serializer.
  const created = await api("POST", "addons/addon/", {
    ...listing, is_disabled: true,
    version: { ...versionMetadata, upload: upload.uuid },
  });
  same(created.guid, guid, "created GUID");
  same(created.is_disabled, true, "atomic publication hold");
  const readHeld = async () => {
    const value = await api("GET", base);
    same(value.guid, guid, "GUID");
    same(value.is_disabled, true, "publication hold");
    requireValue(value.authors?.some(a => a.id === profile.id && a.name === "Aditya"), "Publisher ownership readback mismatch");
    return value;
  };
  await readHeld();
  const sourceForm = new FormData(); sourceForm.set("source", source, "firefox-source.zip");
  await api("PATCH", versionPath, sourceForm);
  await api("PATCH", `${base}eula_policy/`, { privacy_policy: policy });
  same((await api("GET", `${base}eula_policy/?show_source=true`)).privacy_policy, policy, "privacy policy");
  const ids = [];
  for (const [position, asset] of assets.entries()) {
    const form = new FormData();
    form.set("image", asset.file, asset.filename);
    form.set("position", String(position));
    const preview = await api("POST", `${base}previews/`, form);
    requireValue(Number.isSafeInteger(preview.id) && !ids.includes(preview.id), "AMO screenshot identity mismatch");
    ids.push(preview.id);
    // AMO forbids translated captions in multipart preview creation.
    await api("PATCH", `${base}previews/${preview.id}/`, { caption: asset.caption, position });
  }
  let mediaReady = false;
  for (let i = 0; i < 30; i++) {
    const held = await readHeld();
    const previews = held.previews;
    if (previews?.length === assets.length && previews.every((p, index) =>
      p.id === ids[index] && equal(p.caption, assets[index].caption) &&
      equal(p.image_size, [assets[index].width, assets[index].height]) &&
      typeof p.image_url === "string" && p.image_url.startsWith("https://"))) {
      mediaReady = true; break;
    }
    await sleep(2000);
  }
  requireValue(mediaReady, "AMO screenshot readback incomplete; add-on remains disabled");
  const observed = await api("GET", versionPath);
  same(observed.version, version, "version"); same(observed.channel, "listed", "channel");
  same(observed.license?.slug, versionMetadata.license, "license");
  same(observed.approval_notes, versionMetadata.approval_notes, "reviewer instructions");
  requireValue(typeof observed.source === "string" && observed.source.length > 0, "Source archive missing; add-on remains disabled");
  const held = await readHeld();
  for (const field of ["name", "summary", "description"]) same(held[field], listing[field], field);
  same((await api("GET", `${base}eula_policy/?show_source=true`)).privacy_policy, policy, "final privacy policy");
  // This is the only publication-enabling effect. No exception path enables.
  await api("PATCH", base, { is_disabled: false });
  same((await api("GET", base)).is_disabled, false, "publication enable");
  return { version, channel: "listed", policyVerified: true, screenshotIds: ids, sourceAttached: true, outcome: "submitted-not-publicly-verified" };
}

// Single-target metadata only (profile, listing, version, upload status, policy
// and previews), not uploaded ZIP/PNG bodies. This is a client admission budget,
// not an asserted provider maximum. Fetch exposes decompressed response bytes;
// count those independently of a possibly compressed/missing Content-Length.
export const amoResponseLimit = 1024 * 1024;

function cancelBody(body) {
  try { void Promise.resolve(body?.cancel()).catch(() => {}); }
  catch { /* Cancellation must not expose provider errors or stall rejection. */ }
}

export async function readAmoJson(response, { signal, method = "GET" } = {}) {
  let reader;
  let onAbort;
  let rejectRead;
  try {
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/u.test(length) || BigInt(length) > BigInt(amoResponseLimit)))
      throw new Error("declared response exceeds admission");
    signal?.throwIfAborted();
    if (!response.body) throw new Error("missing response body");
    reader = response.body.getReader();
    onAbort = () => { rejectRead?.(new Error("response deadline")); cancelBody(reader); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const bytes = new Uint8Array(amoResponseLimit);
    let size = 0;
    while (true) {
      signal?.throwIfAborted();
      // One pending read/rejection owner, not repeated races against a single
      // pending abort promise that would retain reactions for every tiny chunk.
      const { value, done } = await new Promise((resolve, reject) => {
        rejectRead = reject;
        reader.read().then(resolve, reject);
      });
      rejectRead = undefined;
      signal?.throwIfAborted();
      if (done) break;
      if (!(value instanceof Uint8Array) || value.byteLength > amoResponseLimit - size)
        throw new Error("decoded response exceeds admission");
      bytes.set(value, size);
      size += value.byteLength;
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
    signal?.throwIfAborted();
    return value;
  } catch {
    cancelBody(reader || response.body);
    throw new Error(`AMO ${method} response unreadable or exceeds 1 MiB; reconcile, do not retry`);
  } finally {
    rejectRead = undefined;
    if (onAbort) signal?.removeEventListener("abort", onAbort);
    try { reader?.releaseLock(); } catch { /* Pending/cancelled reader: no provider error exposure. */ }
  }
}

export function createAmoApi({ token, fetcher = fetch }) {
  return async (method, path, data, allow404 = false) => {
    requireValue(/^(?:addons|accounts)\/[A-Za-z0-9@%._/?=\-]+$/u.test(path) && !path.includes(".."), "Invalid AMO API path");
    const multipart = data instanceof FormData;
    const signal = AbortSignal.timeout(30000);
    let response;
    try {
      response = await fetcher(`https://addons.mozilla.org/api/v5/${path}`, {
        method, redirect: "error", signal,
        headers: { Authorization: `JWT ${token()}`, ...(data && !multipart ? { "Content-Type": "application/json" } : {}) },
        body: data ? multipart ? data : JSON.stringify(data) : undefined,
      });
    } catch {
      throw new Error(`AMO ${method} transport outcome unknown; reconcile, do not retry`);
    }
    if (allow404 && method === "GET" && response.status === 404) { cancelBody(response.body); return null; }
    if (!response.ok) {
      cancelBody(response.body);
      throw new Error(`AMO ${method} HTTP ${response.status}; stop and reconcile, do not retry`);
    }
    return readAmoJson(response, { signal, method });
  };
}
