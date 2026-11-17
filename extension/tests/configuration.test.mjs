import { test } from "node:test";
import assert from "node:assert/strict";
import * as configuration from "../compiled/extension/src/configuration.js";
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
    ["remove", { origins: ["https://old.example/*"] }],
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

test("replacing legacy credentials removes only a different service grant", async () => {
  for (const service of ["https://short.example", "https://old.example"]) {
    const calls = [];
    const api = {
      permissions: {
        request: async () => true,
        remove: async (grant) => {
          calls.push(grant);
          return true;
        },
      },
      storage: {
        local: {
          get: async () => ({
            settings: { service, token: "legacy-session-credential" },
          }),
          set: async () => {},
        },
      },
    };
    await saveSettings(api, {
      service: "https://short.example",
      token: "short_at_" + "b".repeat(64),
    });
    assert.deepEqual(
      calls,
      service === "https://old.example"
        ? [{ origins: ["https://old.example/*"] }]
        : [],
    );
  }
});

test("Forget clears legacy settings only after host permission cleanup succeeds, and can retry", async () => {
  let saved = {
    service: "https://old.example",
    token: "legacy-session-credential",
  };
  let allow = false;
  const grants = [];
  const api = {
    permissions: {
      remove: async (grant) => {
        grants.push(grant);
        return allow;
      },
    },
    storage: {
      local: {
        get: async () => ({ settings: saved }),
        remove: async () => {
          saved = undefined;
        },
      },
    },
  };
  assert.equal(typeof configuration.forgetSettings, "function");
  await assert.rejects(configuration.forgetSettings(api), /permission.*retry/i);
  assert.equal(saved.service, "https://old.example");
  allow = true;
  await configuration.forgetSettings(api);
  assert.equal(saved, undefined);
  assert.deepEqual(
    grants,
    Array(2).fill({ origins: ["https://old.example/*"] }),
  );
});

test("replacement cleanup failure preserves the legacy origin for retry without storing a new credential", async () => {
  for (const failure of [false, new Error("browser failure")]) {
    let saved = {
      service: "https://old.example",
      token: "legacy-session-credential",
    };
    let allow = false;
    const api = {
      permissions: {
        request: async () => true,
        remove: async () => {
          if (allow) return true;
          if (failure instanceof Error) throw failure;
          return failure;
        },
      },
      storage: {
        local: {
          get: async () => ({ settings: saved }),
          set: async (value) => {
            saved = value.settings;
          },
        },
      },
    };
    const next = {
      service: "https://short.example",
      token: "short_at_" + "b".repeat(64),
    };
    await assert.rejects(saveSettings(api, next), /permission.*retry/i);
    assert.equal(saved.service, "https://old.example");
    allow = true;
    await saveSettings(api, next);
    assert.deepEqual(saved, next);
  }
});
