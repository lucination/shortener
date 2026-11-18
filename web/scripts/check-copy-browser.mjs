import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

// Run against `npm run dev`: node scripts/check-copy-browser.mjs
// Disposable API fixtures only; clipboard calls use the real browser capability.
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
const links = [1, 2].map((id) => ({
  id,
  owner_id: 1,
  destination: "https://example.org/notes",
  title: `Notes ${id}`,
  description: null,
  enabled: id === 1,
  deleted_at: null,
  expires_at: null,
  click_limit: null,
  human_clicks: 1,
  password_protected: false,
  interstitial: false,
  query_mode: "discard",
  retention_days: null,
  created_at: "2026-11-01T12:00:00Z",
  addresses: [
    { id, domain_id: 1, domain: "example.com", short_code: `notes-${id}` },
  ],
}));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results = [];
try {
  for (const width of [1280, 390])
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        colorScheme,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        const body =
          path === "/api/me"
            ? user
            : path === "/api/links"
              ? { items: links, total: 2 }
              : null;
        assert.notEqual(body, null, `Unexpected fixture request ${path}`);
        return route.fulfill({ status: 200, json: body });
      });
      await page.goto("http://localhost:5173");
      const address = page.getByTitle("Copy short address").first();
      await address.waitFor();
      const statuses = await page
        .locator(".link-status")
        .evaluateAll((badges) =>
          badges.map((dot) => {
            const marker = dot.getBoundingClientRect();
            const cell = dot.closest("td").getBoundingClientRect();
            return Math.abs(
              marker.y + marker.height / 2 - cell.y - cell.height / 2,
            );
          }),
        );
      assert.equal(statuses.length, 2);
      assert(
        statuses.every((offset) => offset <= 1),
        `Uncentered status badges: ${statuses}`,
      );
      await address.scrollIntoViewIfNeeded();
      const before = await page.locator("table").boundingBox();
      await address.click();
      const toast = page.locator(".toast");
      await toast.waitFor();
      assert.equal(await toast.textContent(), "Short address copied.");
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        "https://example.com/notes-1",
      );
      const rect = await toast.boundingBox();
      assert(rect && rect.x >= 8 && rect.x + rect.width <= width - 8);
      assert(
        Math.abs(800 - rect.y - rect.height - 16) <= 1,
        JSON.stringify(rect),
      );
      const after = await page.locator("table").boundingBox();
      assert.deepEqual(after, before, "Copy feedback must not move the table");
      await toast.waitFor({ state: "hidden", timeout: 6000 });
      // The second copy path lives in the row's More actions menu.
      const more = page
        .getByRole("button", { name: /^More actions for / })
        .nth(1);
      await more.scrollIntoViewIfNeeded();
      await more.click();
      await page.getByRole("menuitem", { name: "Copy address" }).click();
      await toast.waitFor();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        "https://example.com/notes-2",
      );
      await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: () => Promise.reject(new Error("Injected denial")),
        });
      });
      await address.click();
      await page
        .getByText("Clipboard unavailable. Select and copy the short address.")
        .waitFor();
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await page
        .getByRole("heading", { name: "Email address", exact: true })
        .waitFor();
      assert.equal(await toast.count(), 0);
      results.push({
        width,
        colorScheme,
        clipboard: "real write/read passed",
        bottomToast: "passed",
        layoutStable: true,
        iconCopy: "passed",
        injectedRejection: "passed",
        emailHeading: "passed",
      });
      await context.close();
    }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
