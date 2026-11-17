import { test } from "node:test";
import assert from "node:assert/strict";
import { startPopup } from "../compiled/extension/src/application.js";

test("popup captures the active page, publishes loading while the API is held, then copies the single created result", async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const states = [],
    copies = [],
    queries = [];
  const api = {
    tabs: {
      query: async (query) => {
        queries.push(query);
        return [{ title: "Active title", url: "https://page.example/" }];
      },
    },
    storage: {
      local: {
        get: async () => ({
          settings: {
            service: "https://short.example",
            token:
              "short_at_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          },
        }),
      },
    },
    permissions: { contains: async () => true },
  };
  const running = startPopup(
    api,
    { create: async () => held, copyText: async (text) => copies.push(text) },
    (state) => states.push(state),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queries, [{ active: true, currentWindow: true }]);
  assert.deepEqual(states, [{ kind: "loading" }]);
  assert.deepEqual(copies, []);
  release({
    addresses: [{ domain_id: 1, domain: "short.example", short_code: "abc" }],
  });
  await running;
  assert.equal(states.at(-1).kind, "ready");
  assert.equal(states.at(-1).title, "Active title");
  assert.deepEqual(copies, ["https://short.example/abc"]);
});

test("missing settings and denied host access do not create a link", async () => {
  for (const saved of [
    {},
    {
      settings: {
        service: "https://short.example",
        token:
          "short_at_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
    },
  ]) {
    const states = [];
    let creates = 0;
    await startPopup(
      {
        tabs: { query: async () => [{ url: "https://page.example" }] },
        storage: { local: { get: async () => saved } },
        permissions: { contains: async () => false },
      },
      {
        create: async () => {
          creates++;
        },
        copyText: async () => {},
      },
      (state) => states.push(state),
    );
    assert.equal(creates, 0);
    assert.equal(states.at(-1).kind, saved.settings ? "error" : "setup");
  }
});
