import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "../../web/node_modules/jsdom/lib/api.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("popup excludes competing copy handlers through rich rejection and fallback, then recovers", async () => {
  const { window } = new JSDOM(
    '<main id="app"></main><button id="settings"></button>',
  );
  const saved = new Map();
  const install = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  let finishAuto, rejectRich;
  let clipboard = "",
    plainWrites = 0,
    richWrites = 0,
    fallbackWrites = 0;
  let fallbackWorks = true;
  const url = "https://short.example/abc";
  try {
    install("document", window.document);
    install("chrome", {
      tabs: {
        query: async () => [{ title: "Article", url: "https://page.example/" }],
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
    });
    install(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            addresses: [
              { domain_id: 1, domain: "short.example", short_code: "abc" },
            ],
          }),
          { status: 201 },
        ),
    );
    install(
      "ClipboardItem",
      class {
        constructor(data) {
          this.data = data;
        }
      },
    );
    install("navigator", {
      clipboard: {
        writeText: async (text) => {
          plainWrites++;
          if (plainWrites === 1)
            await new Promise((resolve) => {
              finishAuto = resolve;
            });
          clipboard = text;
        },
        write: () => {
          richWrites++;
          return new Promise((_, reject) => {
            rejectRich = reject;
          });
        },
      },
    });
    window.document.execCommand = () => {
      if (!fallbackWorks) return false;
      const event = new window.Event("copy", { cancelable: true });
      const data = {};
      event.clipboardData = {
        setData: (type, value) => {
          data[type] = value;
        },
      };
      window.document.dispatchEvent(event);
      clipboard = data["text/plain"];
      fallbackWrites++;
      return true;
    };
    await import(`../compiled/extension/src/popup.js?race=${Date.now()}`);
    await tick();
    assert.equal(typeof finishAuto, "function");
    assert.equal(
      window.document.querySelector("#app a"),
      null,
      "automatic write settles before actions are published",
    );
    finishAuto();
    await tick();
    const title = window.document.querySelector(".title");
    const button = window.document.querySelector("#app button");
    const feedback = () =>
      window.document.querySelector("#feedback").textContent;
    const click = (element) => {
      const event = new window.MouseEvent("click", { cancelable: true });
      element.dispatchEvent(event);
      return event;
    };
    assert.equal(title.href, url);
    assert.equal(click(title).defaultPrevented, true);
    click(button); // dispatchEvent deliberately bypasses native disabled-click suppression.
    await tick();
    rejectRich(new Error("held rich write denied"));
    await tick();
    assert.equal(clipboard, url);
    assert.equal(
      feedback(),
      "Formatted link copied.",
      "feedback must describe the clipboard after the old rich fallback",
    );
    assert.equal(
      plainWrites,
      1,
      "competing URL handler must not start a write",
    );
    assert.equal(
      richWrites,
      1,
      "competing title handler must not start a write",
    );
    assert.equal(fallbackWrites, 1);
    assert.equal(button.disabled, false);
    click(button);
    await tick();
    assert.equal(clipboard, url);
    assert.equal(feedback(), "URL copied.");
    fallbackWorks = false;
    click(title);
    click(title); // A second programmatic title event is also excluded.
    rejectRich(new Error("rich denied again"));
    await tick();
    assert.match(feedback(), /Formatted copy failed/);
    assert.equal(richWrites, 2);
    assert.equal(button.disabled, false, "failure releases both actions");
    click(button);
    await tick();
    assert.equal(clipboard, url);
    assert.equal(feedback(), "URL copied.");
    let rejectPlain;
    const writeText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () =>
      new Promise((_, reject) => {
        rejectPlain = reject;
      });
    click(button);
    assert.equal(button.disabled, true);
    click(title);
    click(button);
    rejectPlain(new Error("plain copy denied"));
    await tick();
    assert.equal(richWrites, 2, "pending plain copy excludes rich writes too");
    assert.match(feedback(), /Copy failed/);
    assert.equal(button.disabled, false);
    navigator.clipboard.writeText = writeText;
    click(button);
    await tick();
    assert.equal(clipboard, url);
    assert.equal(feedback(), "URL copied.");
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    window.close();
  }
});
