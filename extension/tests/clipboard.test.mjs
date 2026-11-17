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
