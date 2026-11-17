import { test } from "node:test";
import assert from "node:assert/strict";
import { shorten } from "../compiled/extension/src/application.js";

test("creates the active page under existing user authority and automatically copies the plain short URL", async () => {
  const calls = [];
  const result = await shorten(
    { service: "https://short.example", token: "user-session" },
    { title: "A page", url: "https://page.example/article" },
    {
      create: async (settings, input) => {
        calls.push({ settings, input });
        return {
          addresses: [
            { domain_id: 1, domain: "short.example", short_code: "abc123" },
          ],
        };
      },
      copyText: async (text) => calls.push(text),
    },
  );
  assert.deepEqual(result, {
    kind: "ready",
    title: "A page",
    url: "https://short.example/abc123",
    copied: true,
  });
  assert.equal(calls[0].input.destination, "https://page.example/article");
  assert.equal(calls[0].input.title, "A page");
  assert.equal(calls[1], result.url);
});

test("rejects unsafe or malformed short addresses before clipboard output", async () => {
  for (const address of [
    { domain_id: 1, domain: "evil.test/path", short_code: "abc" },
    { domain_id: 1, domain: "user@evil.test", short_code: "abc" },
    { domain_id: 1, domain: "short.example", short_code: "../admin" },
    { domain_id: 1, domain: "short.example", short_code: "a?x" },
    { domain_id: 2, domain: "short.example", short_code: "abc" },
    null,
  ]) {
    let copied = false;
    const result = await shorten(
      { service: "https://short.example", token: "session" },
      { url: "https://page.example" },
      {
        create: async () => ({ addresses: [address] }),
        copyText: async () => {
          copied = true;
        },
      },
    );
    assert.equal(result.kind, "error", JSON.stringify(address));
    assert.equal(copied, false);
  }
});

test("clipboard denial preserves the created link for an explicit retry without another POST", async () => {
  let creates = 0;
  const result = await shorten(
    { service: "https://short.example", token: "session" },
    { title: "Title", url: "https://page.example/" },
    {
      create: async () => {
        creates++;
        return {
          addresses: [
            { domain_id: 1, domain: "short.example", short_code: "abc" },
          ],
        };
      },
      copyText: async () => {
        throw new Error("denied");
      },
    },
  );
  assert.equal(result.kind, "ready");
  assert.equal(result.copied, false);
  assert.equal(creates, 1);
});

test("invalid settings and unsupported pages fail before transmitting credentials", async () => {
  for (const service of [
    "javascript:alert(1)",
    "https://u:p@short.example",
    "https://short.example/api",
    "https://short.example/?q=x",
    "https://short.example/#x",
    "http://remote.example",
    "not a url",
  ]) {
    let calls = 0;
    const result = await shorten(
      { service, token: "session" },
      { url: "https://page.example" },
      {
        create: async () => {
          calls++;
          return {};
        },
        copyText: async () => {},
      },
    );
    assert.equal(result.kind, "error", service);
    assert.equal(calls, 0, service);
  }
  for (const url of [
    "chrome://settings",
    "about:blank",
    "file:///secret",
    "https://u:p@example.test/",
    undefined,
  ]) {
    let calls = 0;
    const result = await shorten(
      { service: "https://short.example", token: "session" },
      { url },
      {
        create: async () => {
          calls++;
          return {};
        },
        copyText: async () => {},
      },
    );
    assert.equal(result.kind, "error", String(url));
    assert.equal(calls, 0);
  }
});
