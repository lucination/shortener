import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

test("all platforms package shared popup with minimal permissions and no persistent background or remote code", async () => {
  for (const platform of ["chrome", "firefox", "safari"]) {
    const manifest = JSON.parse(
      await readFile(
        new URL(`../dist/${platform}/manifest.json`, import.meta.url),
      ),
    );
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions.sort(), [
      "activeTab",
      "clipboardWrite",
      "storage",
    ]);
    assert.equal(manifest.action.default_popup, "popup.html");
    assert.equal(manifest.options_ui.page, "settings.html");
    assert.equal(manifest.background, undefined);
    assert.equal(manifest.content_scripts, undefined);
    assert.deepEqual(manifest.host_permissions ?? [], []);
    assert.deepEqual(manifest.optional_host_permissions, [
      "https://*/*",
      "http://*/*",
    ]);
    const files = await readdir(
      new URL(`../dist/${platform}/`, import.meta.url),
    );
    for (const name of [
      "popup.html",
      "settings.html",
      "popup.js",
      "settings.js",
      "core.js",
      "api.js",
      "clipboard.js",
      "extension.css",
    ])
      assert.ok(files.includes(name), name);
    const popup = await readFile(
      new URL(`../dist/${platform}/popup.html`, import.meta.url),
      "utf8",
    );
    assert.ok(popup.includes('type="module"'));
    assert.ok(!files.includes("fonts"), "unused fonts are not shipped");
    assert.deepEqual(
      await readFile(new URL(`../dist/${platform}/theme.css`, import.meta.url)),
      await readFile(
        new URL("../../web/src/lib/styles/presentation.css", import.meta.url),
      ),
    );
  }
});

test("Firefox declares transmitted browsing activity and requires built-in consent", async () => {
  const {
    browser_specific_settings: { gecko },
  } = JSON.parse(
    await readFile(new URL("../dist/firefox/manifest.json", import.meta.url)),
  );
  assert.equal(gecko.strict_min_version, "140.0");
  assert.deepEqual(gecko.data_collection_permissions, {
    required: ["browsingActivity", "authenticationInfo", "websiteContent"],
  });
});
