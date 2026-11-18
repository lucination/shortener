import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
test("user correction: actual packaged UI uses current app tokens and system sans, not the old monospace paper grid", async () => {
  const css = await readFile(
    new URL("../dist/firefox/extension.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /system-ui/);
  assert.doesNotMatch(css, /JetBrains|--paper|double|@font-face/);
  assert.deepEqual(
    await readFile(new URL("../dist/firefox/theme.css", import.meta.url)),
    await readFile(
      new URL("../../web/src/lib/styles/presentation.css", import.meta.url),
    ),
  );
  assert.ok(
    !(await readdir(new URL("../dist/firefox/", import.meta.url))).includes(
      "fonts",
    ),
  );
});
