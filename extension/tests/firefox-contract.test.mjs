import { test } from "node:test";
import assert from "node:assert/strict";
const api = await import("./firefox-contract.mjs").catch(() => ({
  assertRequest: () => {},
  assertClipboard: () => {},
}));
test("fixture request rejects service origin masquerading as active tab and leaked cookies", () => {
  const expected = {
    destination: "http://localhost:1234/article",
    title: "Article & Notes <proof>",
    token: "fixture",
  };
  assert.throws(() =>
    api.assertRequest(
      {
        method: "POST",
        path: "/api/links",
        body: { destination: "http://127.0.0.1:4567/", title: expected.title },
        authorization: "Bearer fixture",
        cookie: "session=leak",
      },
      expected,
    ),
  );
});
test("valid wire fixture is accepted; wrong title, cookie or authority fails", () => {
  const expected = {
    destination: "http://localhost:1234/article",
    title: "Article & Notes <proof>",
    token: "fixture",
  };
  const good = {
    method: "POST",
    path: "/api/links",
    body: {
      destination: expected.destination,
      title: expected.title,
      alias: null,
    },
    authorization: "Bearer fixture",
  };
  assert.doesNotThrow(() => api.assertRequest(good, expected));
  for (const bad of [
    { ...good, cookie: "short_session=fixture" },
    { ...good, authorization: undefined },
    { ...good, body: { ...good.body, title: "wrong" } },
  ])
    assert.throws(() => api.assertRequest(bad, expected));
});
test("native clipboard contract tolerates browser HTML envelope but never title in plain text", () => {
  const expected = {
    url: "http://127.0.0.1:123/abc",
    title: "Article & Notes <proof>",
  };
  const html = `<meta charset="utf-8"><a href="${expected.url}">Article &amp; Notes &lt;proof&gt;</a>`;
  assert.doesNotThrow(() => api.assertClipboard(expected.url, html, expected));
  assert.throws(() =>
    api.assertClipboard(expected.title + " " + expected.url, html, expected),
  );
  assert.throws(() =>
    api.assertClipboard(
      expected.url,
      '<a href="https://wrong.example">wrong</a>',
      expected,
    ),
  );
});
test("browser UI authority is explicitly granted to geckodriver, not only Firefox", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("./firefox.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /new firefox\.ServiceBuilder\([^]*?\.addArguments\("--allow-system-access"\)/,
  );
});
test("explicit plain copy cannot pass using automatic-copy stale clipboard data", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("./firefox.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /input: "plain sentinel"[^]*await clickPopup\("#app button"\)/,
  );
});
