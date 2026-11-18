// Real application/adapters with deterministic test-local HTTP responses only.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.DASHBOARD_APP_BASE;
const output = process.env.DASHBOARD_EVIDENCE_DIR;
assert.ok(
  base && output,
  "explicit isolated app URL and evidence directory required",
);
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(base).hostname),
  "loopback fixture only",
);
await mkdir(output, { recursive: true });
const user = {
  id: 1,
  email: "reader@example.org",
  verified_at: "2026-11-14T10:00:00Z",
  suspended: false,
  deleted_at: null,
  retention_days: 90,
  link_quota: null,
  created_at: "2026-11-14T10:00:00Z",
};
const links = ["Notes", "Handbook", "Archive"].map((title, index) => ({
  id: index + 1,
  owner_id: 1,
  destination: `https://example.org/${title.toLowerCase()}`,
  title,
  description: null,
  enabled: index !== 2,
  deleted_at: null,
  expires_at: null,
  click_limit: null,
  human_clicks: [1284, 386, 92][index],
  password_protected: false,
  interstitial: false,
  query_mode: "discard",
  retention_days: null,
  created_at: "2026-11-01T12:00:00Z",
  addresses: [
    {
      id: index + 1,
      domain_id: 1,
      domain: "example.com",
      short_code: title.toLowerCase(),
    },
  ],
}));
const actions = [
  ["enable", "Enable selected links", "Enable"],
  ["disable", "Disable selected links", "Disable"],
  ["delete", "Delete selected links", "Delete"],
  ["expiration", "Set expiration", "Set expiration"],
  ["retention", "Set retention", "Set retention"],
];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const observations = [],
  errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const writes = [];
  await page.route("**/api/**", (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let value;
    if (req.method() !== "GET") {
      assert.equal(path, "/api/links/bulk-update");
      assert.equal(req.method(), "POST");
      writes.push(req.postDataJSON());
      value = { updated: [], items: [] };
    } else if (path === "/api/me") value = user;
    else {
      assert.equal(path, "/api/links");
      value = { items: links, total: links.length };
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  for (const theme of ["light", "dark"])
    for (const width of [1280, 390]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 844 });
      await page.goto(base);
      const all = page.getByTitle("Select all visible links");
      await all.waitFor();
      await page.getByTitle("Select Archive", { exact: true }).check();
      assert.equal(await all.evaluate((e) => e.indeterminate), true);
      const search = page.getByPlaceholder(
        "Search links, destinations, aliases…",
      );
      await search.fill("Notes");
      await all.check();
      await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
      await all.uncheck();
      await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
      await search.fill("");
      assert.equal(
        await page.getByTitle("Select Archive", { exact: true }).isChecked(),
        true,
      );
      await all.check();
      await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
      await all.uncheck();
      assert.equal(await all.evaluate((e) => e.indeterminate), false);
      for (const count of [1, 2])
        for (const [action, title, verb] of actions) {
          for (const link of links.slice(0, count))
            await page
              .getByTitle(`Select ${link.title}`, { exact: true })
              .check();
          await expect(
            page.getByText(`${count} selected`, { exact: true }),
          ).toBeVisible();
          const icons = await page
            .locator(".box-frame.toolbar button")
            .evaluateAll((nodes) =>
              nodes.map((n) => {
                const r = n.getBoundingClientRect();
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  icon: !!n.querySelector("svg"),
                  text: n.textContent.trim(),
                };
              }),
            );
          assert.equal(icons.length, 5);
          for (const icon of icons) {
            assert.equal(icon.width, 32);
            assert.equal(icon.height, 32);
            assert.equal(icon.y, icons[0].y);
            assert.ok(icon.icon);
            assert.equal(icon.text, "");
            assert.ok(icon.x >= 0 && icon.x + icon.width <= width);
          }
          const before = writes.length;
          await page.getByTitle(title, { exact: true }).click();
          const noun = count === 1 ? "link" : "links",
            valueForm = action === "expiration" || action === "retention";
          const heading = valueForm
            ? `${verb} for ${count} ${noun}`
            : `${verb} ${count} ${noun}?`;
          await expect(
            page.getByRole("heading", { name: heading, exact: true }),
          ).toBeVisible();
          if (!valueForm && action !== "delete")
            await expect(
              page.getByText(`Apply this change to the selected ${noun}.`, {
                exact: true,
              }),
            ).toBeVisible();
          assert.equal(
            writes.length,
            before,
            "opening confirmation does not write",
          );
          await page
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          assert.equal(writes.length, before, "cancelling does not write");
          await page.getByTitle(title, { exact: true }).click();
          if (action === "retention")
            await page.getByLabel("Retention days", { exact: true }).fill("30");
          if (action === "expiration")
            await page
              .getByLabel("Expiration", { exact: true })
              .fill("2030-12-31T12:00");
          await page
            .getByRole("button", { name: "Confirm", exact: true })
            .click();
          await expect.poll(() => writes.length).toBe(before + 1);
          const expectedAction =
            action === "retention"
              ? { type: action, retention_days: 30 }
              : action === "expiration"
                ? {
                    type: action,
                    expires_at: await page.evaluate(() =>
                      new Date("2030-12-31T12:00").toISOString(),
                    ),
                  }
                : { type: action };
          assert.deepEqual(writes.at(-1), {
            ids: links.slice(0, count).map((l) => l.id),
            action: expectedAction,
          });
          await expect(
            page.getByRole("heading", { name: heading, exact: true }),
          ).toHaveCount(0);
          await expect(page.locator(".box-frame.toolbar")).toHaveCount(0);
          observations.push({
            theme,
            width,
            count,
            action,
            heading,
            payload: writes.at(-1),
          });
        }
      await page.screenshot({ path: `${output}/app-${theme}-${width}.png` });
    }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/selection.json`,
  JSON.stringify({ observations, errors }, null, 2),
);
assert.deepEqual(errors, []);
console.log(
  JSON.stringify({ workflows: observations.length, errors, fixtureOnly: true }),
);
