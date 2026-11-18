import { test } from "node:test";
import assert from "node:assert/strict";
import { createAmoApi } from "../scripts/amo-listing.mjs";
import { readAmoJson, amoResponseLimit } from "../scripts/amo-listing.mjs";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

const limit = 1024 * 1024;

test("rejects a previously accepted 2 MiB JSON response without retry", async () => {
  let calls = 0;
  const api = createAmoApi({ token: () => "test-auth", fetcher: async () => {
    calls++;
    return new Response(JSON.stringify({ value: "x".repeat(2 * limit) }));
  } });
  await assert.rejects(() => api("PATCH", "addons/addon/test/eula_policy/", {}), /response .*reconcile.*do not retry/);
  assert.equal(calls, 1);
});

function trackedResponse(chunks, { headers, hold = false, interrupt = false, status = 200 } = {}) {
  const state = { pulls: 0, cancels: 0 };
  let index = 0;
  const body = new ReadableStream({
    pull(controller) {
      state.pulls++;
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else if (interrupt) controller.error(new Error("provider-secret-must-not-escape"));
      else if (!hold) controller.close();
    },
    cancel() { state.cancels++; },
  }, { highWaterMark: 0 });
  return { response: new Response(body, { headers, status }), state };
}

const safeError = error => {
  assert.match(error.message, /^AMO PATCH response unreadable or exceeds 1 MiB; reconcile, do not retry$/);
  assert.doesNotMatch(error.stack, /provider-secret|test-auth/);
  assert.equal(error.cause, undefined);
  return true;
};

test("declared oversized response is cancelled before any body read", async () => {
  assert.equal(amoResponseLimit, limit);
  const { response, state } = trackedResponse([], { headers: { "Content-Length": String(2 * limit) }, hold: true });
  await assert.rejects(() => readAmoJson(response, { method: "PATCH" }), safeError);
  assert.deepEqual(state, { pulls: 0, cancels: 1 });
  assert.equal(response.body.locked, false);
});

for (const header of [undefined, "1"]) {
  test(`stream overflow cancels immediately with ${header === undefined ? "no length" : "understated length"}`, async () => {
    const bytes = Buffer.alloc(limit + 1, 32);
    Buffer.from('{"ok":true}').copy(bytes);
    const { response, state } = trackedResponse([bytes.subarray(0, limit - 1), bytes.subarray(limit - 1)], { headers: header ? { "Content-Length": header } : undefined });
    await assert.rejects(() => readAmoJson(response, { method: "PATCH" }), safeError);
    assert.deepEqual(state, { pulls: 2, cancels: 1 });
    assert.equal(response.body.locked, false);
  });
}

test("exact decoded byte limit accepts valid UTF-8 split inside a multibyte character", async () => {
  const bytes = Buffer.alloc(limit, 32);
  const prefix = Buffer.from('{"value":"é"}');
  prefix.copy(bytes);
  const split = prefix.indexOf(0xc3) + 1;
  const { response, state } = trackedResponse([bytes.subarray(0, split), bytes.subarray(split)], { headers: { "Content-Length": String(limit) } });
  assert.deepEqual(await readAmoJson(response, { method: "PATCH" }), { value: "é" });
  assert.equal(state.cancels, 0);
  assert.equal(response.body.locked, false);
});

test("malformed JSON exposes no response text or parser cause", async () => {
  const response = new Response('{"provider-secret-must-not-escape":');
  await assert.rejects(() => readAmoJson(response, { method: "PATCH" }), safeError);
  assert.equal(response.body.locked, false);
});

test("invalid UTF-8 is rejected rather than silently repaired", async () => {
  const response = new Response(Uint8Array.from([123, 34, 120, 34, 58, 34, 255, 34, 125]));
  await assert.rejects(() => readAmoJson(response, { method: "PATCH" }), safeError);
});

test("interrupted response is sanitized, releases its reader and never retries", async () => {
  const { response } = trackedResponse([Buffer.from('{"ok":')], { interrupt: true });
  let calls = 0;
  const api = createAmoApi({ token: () => "test-auth", fetcher: async () => { calls++; return response; } });
  await assert.rejects(() => api("PATCH", "addons/addon/test/eula_policy/", {}), safeError);
  assert.equal(calls, 1);
  assert.equal(response.body.locked, false);
});

test("deadline during a held read cancels the body and rejects with sanitized reconciliation guidance", { timeout: 2000 }, async () => {
  const { response, state } = trackedResponse([], { hold: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("provider-secret-must-not-escape")), 10);
  try {
    await assert.rejects(() => readAmoJson(response, { signal: controller.signal, method: "PATCH" }), safeError);
    assert.equal(state.cancels, 1);
    assert.equal(response.body.locked, false);
  } finally { clearTimeout(timer); }
});

test("an already aborted deadline cancels before reading and never exposes its reason", async () => {
  const { response, state } = trackedResponse([], { hold: true });
  const controller = new AbortController();
  controller.abort(new Error("provider-secret-must-not-escape"));
  await assert.rejects(() => readAmoJson(response, { signal: controller.signal, method: "PATCH" }), safeError);
  assert.deepEqual(state, { pulls: 0, cancels: 1 });
});

test("cancellation failure cannot leak provider errors or replace bounded rejection", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    cancel() { cancelled = true; throw new Error("provider-secret-must-not-escape"); },
  }, { highWaterMark: 0 }), { headers: { "Content-Length": String(2 * limit) } });
  await assert.rejects(() => readAmoJson(response, { method: "PATCH" }), safeError);
  assert.equal(cancelled, true);
  await new Promise(resolve => setImmediate(resolve)); // An unhandled cancellation rejection fails the test runner.
});

for (const encoding of ["gzip", "chunked"]) test(`HTTP ${encoding} response is bounded after native fetch decoding`, async () => {
  const decoded = Buffer.from(JSON.stringify({ value: "x".repeat(2 * limit) }));
  const compressed = gzipSync(decoded);
  assert.ok(compressed.byteLength < limit);
  let calls = 0;
  const server = createServer((_, response) => {
    calls++;
    if (encoding === "gzip") {
      response.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": compressed.byteLength });
      response.end(compressed);
    } else {
      response.writeHead(200, { "Content-Type": "application/json", "Transfer-Encoding": "chunked" });
      response.write(decoded.subarray(0, limit));
      response.end(decoded.subarray(limit));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const api = createAmoApi({ token: () => "test-auth", fetcher: async (_, init) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/`, { method: init.method, signal: init.signal, redirect: init.redirect });
      if (encoding === "chunked") { assert.equal(response.headers.get("content-length"), null); assert.equal(response.headers.get("transfer-encoding"), "chunked"); }
      return response;
    } });
    await assert.rejects(() => api("PATCH", "addons/addon/test/eula_policy/", {}), safeError);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

for (const status of [404, 503]) {
  test(`HTTP ${status} cancels unconsumed response without parsing or retry`, async () => {
    const { response, state } = trackedResponse([], { hold: true, status });
    let calls = 0;
    const api = createAmoApi({ token: () => "test-auth", fetcher: async () => { calls++; return response; } });
    if (status === 404) assert.equal(await api("GET", "addons/addon/test/", undefined, true), null);
    else await assert.rejects(() => api("PATCH", "addons/addon/test/", {}), /HTTP 503; stop and reconcile, do not retry/);
    assert.equal(calls, 1);
    assert.deepEqual(state, { pulls: 0, cancels: 1 });
  });
}
