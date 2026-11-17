import { test } from "node:test";
import assert from "node:assert/strict";
import { hyperlink } from "../compiled/extension/src/clipboard.js";

test("rich copy escapes hostile page titles and includes a readable plain fallback", () => {
  assert.deepEqual(
    hyperlink(
      '<img src=x onerror="evil()"> & Notes',
      "https://short.example/abc",
    ),
    {
      html: '<a href="https://short.example/abc">&lt;img src=x onerror=&quot;evil()&quot;&gt; &amp; Notes</a>',
      text: '<img src=x onerror="evil()"> & Notes (https://short.example/abc)',
    },
  );
});
