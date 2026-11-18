import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const metadata = JSON.parse(await readFile(new URL("../amo-metadata.json", import.meta.url), "utf8"));

test("first listed submission explicitly supplies AMO v5 localized name and per-application categories", () => {
  assert.deepEqual(metadata.name, { "en-US": "Shortener Companion" });
  assert.deepEqual(metadata.categories, { firefox: ["other"], android: ["other"] });
  assert.ok(metadata.summary["en-US"]);
  assert.ok(metadata.description["en-US"]);
  assert.ok(metadata.privacy_policy["en-US"]);
  assert.equal(metadata.version.license, "all-rights-reserved");
});

test("private reviewer notes give pinned self-hosted setup, not nonexistent hosted credentials", async () => {
  const notes = metadata.version.approval_notes;
  for (const text of [
    "0.1.0", "git clone https://github.com/lucination/shortener.git",
    "git checkout --detach 783feaa68db35792e3b4b3570f73c4ee56a67113",
    'export ADMIN_TOKEN="$(openssl rand -hex 32)"',
    'export ANALYTICS_SECRET="$(openssl rand -hex 32)"',
    "docker compose -f extension/reviewer-compose.yaml config --quiet",
    "docker compose -f extension/reviewer-compose.yaml up -d --wait",
    "http://localhost/_/", "http://localhost:8025",
    "Add user", "Email address", "Confirm", "Send sign-in link",
    "Account", "Access tokens", "Token name", "Create access token",
    "Copy token", "Service URL", "http://localhost", "Access token",
    "Save", "Copy URL", "Copy Markdown", "Forget settings", "Revoke",
    "source archive does not contain the server", "immutable image", "port 80",
  ]) assert.ok(notes.includes(text), `missing reviewer instruction: ${text}`);
  assert.doesNotMatch(notes, /short_at_[0-9a-f]{64}/u);
  const settings = await readFile(new URL("../static/settings.html", import.meta.url), "utf8");
  for (const label of ["Service URL", "Access token", "Forget settings"])
    assert.ok(settings.includes(label));
});
