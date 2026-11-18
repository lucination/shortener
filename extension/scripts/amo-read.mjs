const requireValue = (value, message) => { if (!value) throw new Error(message); };

// AMO v5 FileUploadSerializer uses UUIDField(format='hex'): exactly 32
// lowercase hex characters. Preserve the provider token; never repair it.
export function parseUploadIdentity(value) {
  requireValue(typeof value === "string" && /^[0-9a-f]{32}$/u.test(value), "Invalid AMO upload identity; reconcile, do not retry");
  return value;
}

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

export function createAmoReadOnlyGet({ token, fetcher = fetch }) {
  return async (path, allow404 = false) => {
    requireValue(/^(?:addons|accounts)\/[A-Za-z0-9@%._/?=&\-]+$/u.test(path) && !path.includes(".."), "Invalid AMO API path");
    const signal = AbortSignal.timeout(30000);
    let jwt;
    try { jwt = await token(); }
    catch { throw new Error("AMO GET token generation failed; stop and inspect access"); }
    let response;
    try { response = await fetcher(`https://addons.mozilla.org/api/v5/${path}`, {
      method: "GET", redirect: "error", signal,
      headers: { Authorization: `JWT ${jwt}` },
    }); } catch { throw new Error("AMO GET transport outcome unknown; stop and inspect access"); }
    if (allow404 && response.status === 404) { cancelBody(response.body); return null; }
    if (!response.ok) { cancelBody(response.body); throw new Error(`AMO GET HTTP ${response.status}; stop and reconcile, do not retry`); }
    return readAmoJson(response, { signal });
  };
}
