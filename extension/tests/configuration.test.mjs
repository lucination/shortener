import { test } from "node:test";
import assert from "node:assert/strict";
import { saveSettings } from "../compiled/extension/src/configuration.js";

test("settings request only the selected service before storing credentials, then revoke the old service grant", async () => {
  const calls = [];
  const api = {
    permissions: {
      request: async (grant) => {
        calls.push(["grant", grant]);
        return true;
      },
      remove: async (grant) => {
        calls.push(["remove", grant]);
        return true;
      },
    },
    storage: {
      local: {
        get: async () => ({
          settings: {
            service: "https://old.example",
            token:
              "short_at_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        }),
        set: async (settings) => calls.push(["store", settings]),
      },
    },
  };
  const running = saveSettings(api, {
    service: "https://short.example/",
    token:
      "short_at_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.deepEqual(
    calls[0],
    ["grant", { origins: ["https://short.example/*"] }],
    "permission request starts during save click, before awaiting storage",
  );
  await running;
  assert.deepEqual(calls, [
    ["grant", { origins: ["https://short.example/*"] }],
    [
      "store",
      {
        settings: {
          service: "https://short.example",
          token:
            "short_at_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
    ],
    ["remove", { origins: ["https://old.example/*"] }],
  ]);
});

test("permission denial and invalid settings never persist the credential", async () => {
  let stored = 0,
    requested = 0;
  const api = {
    permissions: {
      request: async () => {
        requested++;
        return false;
      },
    },
    storage: { local: { set: async () => stored++ } },
  };
  await assert.rejects(
    saveSettings(api, {
      service: "https://short.example",
      token:
        "short_at_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    }),
    /denied/,
  );
  assert.equal(stored, 0);
  await assert.rejects(
    saveSettings(api, {
      service: "https://user:pass@evil.example",
      token:
        "short_at_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    }),
  );
  assert.equal(requested, 1);
});
