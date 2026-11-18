import { test } from "node:test";
import assert from "node:assert/strict";
import { copyRich, hyperlink } from "../compiled/extension/src/clipboard.js";

test("rich copy escapes hostile page titles and includes a URL-only plain fallback", () => {
  assert.deepEqual(
    hyperlink(
      '<img src=x onerror="evil()"> & Notes',
      "https://short.example/abc",
    ),
    {
      html: '<a href="https://short.example/abc">&lt;img src=x onerror=&quot;evil()&quot;&gt; &amp; Notes</a>',
      text: "https://short.example/abc",
    },
  );
});

test("rich copy writes one ClipboardItem with URL-only plaintext and escaped title HTML", async () => {
  const saved = new Map();
  const install = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  let writes = 0;
  let written;
  try {
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
        write: async (items) => {
          writes++;
          written = items;
        },
      },
    });
    await copyRich(
      "A & <B> \"quoted\" 'title'",
      "https://short.example/a?x=1&y=2",
    );
    assert.equal(writes, 1);
    assert.equal(written.length, 1);
    assert.deepEqual(Object.keys(written[0].data).sort(), [
      "text/html",
      "text/plain",
    ]);
    assert.equal(
      await written[0].data["text/plain"].text(),
      "https://short.example/a?x=1&y=2",
    );
    assert.equal(
      await written[0].data["text/html"].text(),
      '<a href="https://short.example/a?x=1&amp;y=2">A &amp; &lt;B&gt; &quot;quoted&quot; &#39;title&#39;</a>',
    );
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test("Markdown formatter escapes hostile labels and parentheses and refuses control/scheme injection", async () => {
  const { markdownLink } =
    await import("../compiled/extension/src/clipboard.js");
  assert.equal(typeof markdownLink, "function");
  assert.equal(
    markdownLink(
      "A [b] " +
        String.fromCharCode(92) +
        " c" +
        String.fromCharCode(13, 10) +
        "<em>*x*",
      "https://short.example/a(b)?x=1&y=2",
    ),
    String.raw`[A \[b\] \\ c \<em\>\*x\*](https://short.example/a%28b%29?x=1&y=2)`,
  );
  assert.equal(
    markdownLink("IPv6", "http://[::1]/a(b)"),
    "[IPv6](http://[::1]/a%28b%29)",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://short.example/a" + String.fromCharCode(10) + "(b)",
    "https://short.example/a" + String.fromCharCode(0),
  ])
    assert.throws(() => markdownLink("x", url));
});

for (const capability of [true, false, undefined, "throws"])
  test(`native Markdown capability ${capability} preserves single-item HTML and URL-only plaintext`, async () => {
    const old = new Map();
    const install = (k, v) => {
      old.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
      Object.defineProperty(globalThis, k, { configurable: true, value: v });
    };
    let written;
    class Item {
      constructor(data) {
        this.data = data;
      }
    }
    if (capability !== undefined)
      Item.supports = () => {
        if (capability === "throws") throw Error("capability unavailable");
        return capability;
      };
    try {
      install("ClipboardItem", Item);
      install("navigator", {
        clipboard: {
          write: async (items) => {
            written = items;
          },
        },
      });
      await copyRich("A [B]", "https://short.example/a");
      assert.equal(written.length, 1);
      assert.deepEqual(
        Object.keys(written[0].data).sort(),
        capability === true
          ? ["text/html", "text/markdown", "text/plain"]
          : ["text/html", "text/plain"],
      );
      assert.equal(
        await written[0].data["text/plain"].text(),
        "https://short.example/a",
      );
      if (capability === true)
        assert.equal(
          await written[0].data["text/markdown"].text(),
          String.raw`[A \[B\]](https://short.example/a)`,
        );
    } finally {
      for (const [k, v] of old)
        v ? Object.defineProperty(globalThis, k, v) : delete globalThis[k];
    }
  });

for (const fallback of ["two-mime", "copy-event", "failure"])
  test(`lying Markdown capability retries two MIME before ${fallback}`, async () => {
    const old = new Map(),
      attempts = [],
      eventData = {};
    let handler;
    const install = (k, v) => {
      old.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
      Object.defineProperty(globalThis, k, { configurable: true, value: v });
    };
    class Item {
      static supports() {
        return true;
      }
      constructor(data) {
        this.data = data;
      }
    }
    try {
      install("ClipboardItem", Item);
      install("navigator", {
        clipboard: {
          write: async (items) => {
            assert.equal(items.length, 1);
            attempts.push(Object.keys(items[0].data).sort());
            if (attempts.length === 1 || fallback !== "two-mime")
              throw Error("unsupported/denied");
          },
        },
      });
      install("document", {
        addEventListener: (_, f) => (handler = f),
        removeEventListener: () => (handler = undefined),
        execCommand: () => {
          if (fallback === "failure") return false;
          handler({
            clipboardData: { setData: (k, v) => (eventData[k] = v) },
            preventDefault() {},
          });
          return true;
        },
      });
      if (fallback === "failure")
        await assert.rejects(copyRich("Title", "https://short.example/a"));
      else await copyRich("Title", "https://short.example/a");
      assert.deepEqual(attempts, [
        ["text/html", "text/markdown", "text/plain"],
        ["text/html", "text/plain"],
      ]);
      if (fallback === "copy-event")
        assert.deepEqual(eventData, {
          "text/html": '<a href="https://short.example/a">Title</a>',
          "text/plain": "https://short.example/a",
        });
      assert.equal(handler, undefined);
    } finally {
      for (const [k, v] of old)
        v ? Object.defineProperty(globalThis, k, v) : delete globalThis[k];
    }
  });

test("advertised Markdown constructor rejection still writes the original two formats", async () => {
  const names = ["ClipboardItem", "navigator"],
    old = names.map((k) => Object.getOwnPropertyDescriptor(globalThis, k)),
    constructed = [];
  let writes = 0;
  class Item {
    static supports() {
      return true;
    }
    constructor(data) {
      constructed.push(Object.keys(data).sort());
      if (data["text/markdown"])
        throw Error("constructor rejects unsupported type");
      this.data = data;
    }
  }
  try {
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: Item,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          write: async (items) => {
            writes++;
            assert.equal(items.length, 1);
            assert.deepEqual(Object.keys(items[0].data).sort(), [
              "text/html",
              "text/plain",
            ]);
          },
        },
      },
    });
    await copyRich("Title", "https://short.example/a");
    assert.equal(writes, 1);
    assert.deepEqual(constructed, [
      ["text/html", "text/markdown", "text/plain"],
      ["text/html", "text/plain"],
    ]);
  } finally {
    names.forEach((k, i) =>
      old[i]
        ? Object.defineProperty(globalThis, k, old[i])
        : delete globalThis[k],
    );
  }
});
