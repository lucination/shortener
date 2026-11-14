// Stateful-adapter regressions. API interception is test-local; no server writes.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3000";
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
// Simulated DTO, never a server observation or a production effect.
const link = {
  id: 1,
  owner_id: 1,
  destination: "https://example.org/notes",
  title: "Notes",
  description: null,
  enabled: true,
  deleted_at: null,
  expires_at: null,
  click_limit: null,
  human_clicks: 0,
  password_protected: false,
  interstitial: false,
  query_mode: "discard",
  retention_days: null,
  created_at: "2026-11-01T12:00:00Z",
  addresses: [
    { id: 1, domain_id: 1, domain: "example.com", short_code: "notes" },
  ],
};
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const receipts = [];
const only = process.env.ONLY;
async function run(name, fn) {
  if (only && !name.includes(only)) return;
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await fn(page);
    assert.deepEqual(errors, []);
    receipts.push({ name, status: "pass" });
  } catch (e) {
    receipts.push({ name, status: "fail", error: String(e) });
  } finally {
    await page.close();
  }
}
const json = (route, value, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
try {
  for (const status of [200, 503])
    for (const target of ["Usage", "Sign out", "New session"])
      await run(`admin held create ${status} -> ${target}`, async (page) => {
        let release;
        const held = new Promise((r) => (release = r));
        let started = false;
        await page.route("**/_/api/**", async (route) => {
          const req = route.request(),
            path = new URL(req.url()).pathname;
          if (path === "/_/api/users" && req.method() === "POST") {
            started = true;
            await held;
            return status === 200
              ? json(route, user)
              : json(route, { code: "server", message: "OLD FAILURE" }, status);
          }
          if (path === "/_/api/usage")
            return json(route, {
              users: 1,
              links: 0,
              redirects: 0,
              raw_events: 0,
            });
          if (path === "/_/api/login")
            return json(route, { message: "signed in" });
          if (path === "/_/api/logout")
            return json(route, { message: "signed out" });
          return json(route, { items: [], total: 0 });
        });
        await page.goto(`${base}/_/`);
        await page
          .getByRole("button", { name: "+ Add user", exact: true })
          .click();
        await page.getByLabel("Email address").fill("new@example.org");
        await page
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await expect.poll(() => started).toBe(true);
        await page
          .getByRole("button", {
            name: target === "New session" ? "Sign out" : target,
            exact: true,
          })
          .click();
        if (target === "New session") {
          await page.getByLabel("Admin token").fill("test-only-adapter-token");
          await page
            .getByRole("button", { name: "Sign in", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Usage", exact: true })
            .click();
          await expect(
            page.getByText("Server-observed usage.", { exact: false }),
          ).toBeVisible();
        }
        if (target === "Sign out")
          await expect(
            page.getByRole("button", { name: "Sign in", exact: true }),
          ).toBeVisible();
        if (target === "Usage" || target === "New session")
          await expect(
            page.getByText("Server-observed usage.", { exact: false }),
          ).toBeVisible();
        release();
        await page.waitForTimeout(100);
        if (target === "Usage" || target === "New session")
          await expect(
            page.getByText("Server-observed usage.", { exact: false }),
          ).toBeVisible();
        if (target === "Cancel")
          await expect(
            page.getByRole("button", { name: "Confirm", exact: true }),
          ).toHaveCount(0);
        if (target === "Sign out")
          await expect(
            page.getByRole("button", { name: "Sign in", exact: true }),
          ).toBeVisible();
        await expect(
          page.getByText("OLD FAILURE", { exact: true }),
        ).toHaveCount(0);
      });
  for (const status of [200, 401, 503])
    await run(`session discovery retry ${status}`, async (page) => {
      let me = 0,
        release;
      const held = new Promise((r) => (release = r));
      const calls = [];
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        calls.push(path);
        if (path === "/api/me") {
          if (++me === 1)
            return json(
              route,
              { code: "server", message: "Initial failure" },
              503,
            );
          await held;
          return json(
            route,
            status === 200
              ? user
              : { code: "failure", message: "Retry failure" },
            status,
          );
        }
        return json(route, { items: [], total: 0 });
      });
      await page.goto(base);
      await page.getByRole("button", { name: "Retry", exact: true }).click();
      await expect.poll(() => me).toBe(2);
      assert.deepEqual(calls, ["/api/me", "/api/me"]);
      release();
      if (status === 200) {
        await expect(
          page.getByRole("button", { name: "Account", exact: true }),
        ).toBeVisible();
        await expect(page.getByText("No matching links")).toBeVisible();
      } else if (status === 401)
        await expect(
          page.getByRole("button", { name: "Send sign-in link" }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("button", { name: "Retry", exact: true }),
        ).toBeVisible();
    });
  for (const status of [200, 503])
    for (const target of ["Cancel", "Account", "Links", "Sign out"])
      await run(`user held import ${status} -> ${target}`, async (page) => {
        let release,
          started = false;
        const held = new Promise((r) => (release = r));
        await page.route("**/api/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/api/me") return json(route, user);
          if (path === "/api/auth/logout")
            return json(route, { message: "signed out" });
          if (path === "/api/links/bulk") {
            started = true;
            await held;
            return status === 200
              ? json(route, { items: [] })
              : json(route, { code: "server", message: "OLD FAILURE" }, status);
          }
          return json(route, { items: [], total: 0 });
        });
        await page.goto(base);
        await expect(
          page.getByRole("button", { name: "Account", exact: true }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Import / paste" }).click();
        await page.getByLabel("URLs / CSV").fill("https://example.org/a,a");
        await page.getByRole("button", { name: "Create 1 links" }).click();
        await expect.poll(() => started).toBe(true);
        await page.getByRole("button", { name: target, exact: true }).click();
        if (target === "Account")
          await expect(page.getByText("Raw click data")).toBeVisible();
        else if (target === "Sign out")
          await expect(page.getByText("Send sign-in link")).toBeVisible();
        else await expect(page.getByText("No matching links")).toBeVisible();
        release();
        await page.waitForTimeout(100);
        await expect(
          page.getByRole("heading", { name: "Import links", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByText("OLD FAILURE", { exact: true }),
        ).toHaveCount(0);
      });
  await run(
    "CSV partial retry preserves quoted records and source lines",
    async (page) => {
      const bodies = [];
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/me") return json(route, user);
        if (path === "/api/links/bulk") {
          bodies.push(route.request().postDataJSON());
          return json(route, {
            items:
              bodies.length === 1
                ? [
                    { index: 0, status: "created", link },
                    {
                      index: 1,
                      status: "failed",
                      error: { code: "conflict", message: "Reserved" },
                    },
                  ]
                : [{ index: 0, status: "created", link }],
          });
        }
        return json(route, { items: [], total: 0 });
      });
      await page.goto(base);
      await expect(
        page.getByRole("button", { name: "Account", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Import / paste" }).click();
      await page
        .getByLabel("URLs / CSV")
        .fill(
          'destination,alias\n\nhttps://example.org/ok,ok\n\n"https://example.org/a,b?\nq=""yes""",retry',
        );
      await page.getByRole("button", { name: "Create 2 links" }).click();
      await expect(page.getByText(/Row 5: Reserved/)).toBeVisible();
      await page.getByRole("button", { name: "Create 1 links" }).click();
      await expect.poll(() => bodies.length).toBe(2);
      assert.deepEqual(bodies[1].items, [bodies[0].items[1]]);
    },
  );
  for (const status of [200, 503])
    await run(`user held delete ${status} -> Account`, async (page) => {
      let release,
        started = false;
      const held = new Promise((r) => (release = r));
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/me") return json(route, user);
        if (route.request().method() === "DELETE") {
          started = true;
          await held;
          return json(
            route,
            status === 200
              ? { message: "deleted" }
              : { code: "server", message: "OLD FAILURE" },
            status,
          );
        }
        return json(route, { items: [link], total: 1 });
      });
      await page.goto(base);
      await page
        .getByRole("button", { name: "Delete link", exact: true })
        .click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect.poll(() => started).toBe(true);
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await expect(page.getByText("Raw click data")).toBeVisible();
      release();
      await page.waitForTimeout(100);
      await expect(page.getByText("Raw click data")).toBeVisible();
      await expect(page.getByText("OLD FAILURE", { exact: true })).toHaveCount(
        0,
      );
    });
} finally {
  await browser.close();
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/review-regressions.json",
    JSON.stringify(receipts, null, 2),
  );
}
console.log(JSON.stringify(receipts, null, 2));
assert(receipts.every((r) => r.status === "pass"));
