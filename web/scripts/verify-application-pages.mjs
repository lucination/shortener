// Built user/admin entrypoints, real adapters, isolated fixture HTTP responses.
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";

const output = process.env.PAGE_EVIDENCE_DIR;
assert.ok(output, "explicit evidence directory required");
await mkdir(output, { recursive: true });
const web = resolve(fileURLToPath(new URL("../build/", import.meta.url)));
const admin = resolve(
  fileURLToPath(new URL("../../admin/build/", import.meta.url)),
);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    const root = path.startsWith("/_/") ? admin : web;
    const relative = root === admin ? path.slice(3) : path.slice(1);
    const target = resolve(root, relative || "index.html");
    if (!target.startsWith(root + "/") && target !== root) {
      res.writeHead(400);
      res.end();
      return;
    }
    let bytes, type;
    try {
      bytes = await readFile(target);
      type = types[extname(target)] || "application/octet-stream";
    } catch {
      bytes = await readFile(resolve(root, "index.html"));
      type = "text/html";
    }
    res.writeHead(200, { "content-type": type });
    res.end(bytes);
  } catch {
    res.writeHead(500);
    res.end("Fixture server unavailable");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
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
  human_clicks: 3,
  password_protected: false,
  interstitial: false,
  query_mode: "discard",
  retention_days: null,
  created_at: "2026-11-01T12:00:00Z",
  addresses: [
    { id: 1, domain_id: 1, domain: "example.com", short_code: "notes" },
  ],
};
const observations = [],
  errors = [],
  requests = [];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const cases = [
  ["links", "/", "Links"],
  ["account", "/", "Account"],
  ["create", "/", "New link"],
  ["import", "/", "Import links"],
  ["events", "/", "Click events"],
  ["editor", "/notes/edit", "Edit link"],
  ["statistics", "/notes/statistics", "Link statistics"],
  ["user-sign-in", "/", "Sign in"],
  ["user-load-error", "/", "Links"],
  ["admin-sign-in", "/_/", "Admin sign in"],
  ["admin-users", "/_/", "Users"],
  ["admin-links", "/_/", "Links"],
  ["admin-usage", "/_/", "Usage"],
  ["admin-events", "/_/", "Events"],
  ["admin-create", "/_/", "Add user"],
  ["admin-confirm", "/_/", "Suspend user #1?"],
];
try {
  for (const theme of ["light", "dark"])
    for (const width of [1440, 390])
      for (const [name, path, heading] of cases) {
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          colorScheme: theme,
        });
        page.on("pageerror", (error) =>
          errors.push({ name, theme, width, error: error.message }),
        );
        await page.route("**/api/**", (route) => {
          const request = route.request(),
            url = new URL(request.url()),
            p = url.pathname;
          requests.push({ name, path: p, method: request.method() });
          assert.equal(
            request.method(),
            "GET",
            "render/navigation must not write",
          );
          let value,
            status = 200;
          if (
            (name === "user-sign-in" && p === "/api/me") ||
            (name === "admin-sign-in" && p.startsWith("/_/api/"))
          ) {
            status = 401;
            value = { code: "unauthorized", message: "Sign in" };
          } else if (name === "user-load-error" && p === "/api/links") {
            status = 503;
            value = { code: "server", message: "Fixture list unavailable" };
          } else if (p === "/api/me") value = user;
          else if (p === "/api/links" || p === "/_/api/links")
            value = { items: [link], total: 1 };
          else if (p === "/_/api/users") value = { items: [user], total: 1 };
          else if (p === "/api/account/passkeys")
            value = { items: [{ id: 1, name: "Laptop" }] };
          else if (p === "/_/api/usage")
            value = { users: 1, links: 1, redirects: 3, raw_events: 0 };
          else if (p.endsWith("/events")) value = { items: [], total: 0 };
          else if (p.endsWith("/stats"))
            value = {
              link_id: 1,
              from: url.searchParams.get("from"),
              to: url.searchParams.get("to"),
              redirects: 3,
              humans: 3,
              bots: 0,
              previews: 0,
              daily: [],
              countries: [],
              devices: [],
              referrers: [],
            };
          else throw Error(`Unexpected fixture read ${p}`);
          return route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(value),
          });
        });
        try {
          await page.goto(base + path);
          if (name === "account")
            await page
              .getByRole("button", { name: "Account", exact: true })
              .click();
          if (name === "create")
            await page
              .getByRole("button", { name: "Create link", exact: true })
              .click();
          if (name === "import")
            await page
              .getByRole("button", { name: "Import / paste", exact: true })
              .click();
          if (name === "events")
            await page.getByTitle("View events", { exact: true }).click();
          if (["admin-links", "admin-usage", "admin-events"].includes(name))
            await page
              .getByRole("button", { name: heading, exact: true })
              .click();
          if (name === "admin-create")
            await page
              .getByRole("button", { name: "Add user", exact: true })
              .click();
          if (name === "admin-confirm")
            await page
              .getByRole("button", { name: "Suspend", exact: true })
              .click();
          const headingNode = page.getByRole("heading", {
            name: heading,
            exact: true,
          });
          // These are existing page titles; keep an explicit assertion if they change.
          await headingNode.waitFor();
          if (name === "account")
            await expect(
              page.getByRole("heading", { name: "Passkeys", exact: true }),
            ).toBeVisible();
          if (name === "user-load-error")
            await expect(
              page.getByText("Fixture list unavailable", { exact: true }),
            ).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const geometry = await page.evaluate(() => {
            const main = document.querySelector("main"),
              s = getComputedStyle(main),
              r = main.getBoundingClientRect();
            return {
              documentWidth: document.documentElement.scrollWidth,
              main: {
                x: r.x,
                width: r.width,
                font: s.fontFamily,
                color: s.color,
                background: s.backgroundColor,
              },
              headings: [...document.querySelectorAll("h1,h2")].map((n) => ({
                text: n.textContent,
                size: getComputedStyle(n).fontSize,
              })),
              controls: [
                ...document.querySelectorAll("button,input,select,textarea"),
              ]
                .filter((n) => !n.closest("table"))
                .map((n) => {
                  const r = n.getBoundingClientRect();
                  return {
                    text: n.textContent.trim(),
                    x: r.x,
                    right: r.right,
                    width: r.width,
                    height: r.height,
                  };
                }),
              dialog: !!document.querySelector(".focused-dialog"),
              nav: [...document.querySelectorAll("nav button")].map((n) =>
                n.textContent.trim(),
              ),
            };
          });
          assert.ok(
            geometry.documentWidth <= width + 1,
            `${name} document overflow`,
          );
          for (const c of geometry.controls)
            if (c.width > 0)
              assert.ok(
                c.x >= -1 && c.right <= width + 1,
                `${name} control outside viewport: ${c.text}`,
              );
          for (const h of geometry.headings)
            assert.ok(parseFloat(h.size) <= 20, `${name} heading density`);
          const adminPage = name.startsWith("admin-");
          if (adminPage)
            assert.ok(
              geometry.nav.every((t) =>
                ["Users", "Links", "Usage", "Events"].includes(t),
              ),
              "separate admin navigation",
            );
          else
            assert.ok(
              geometry.nav.every((t) => ["Links", "Account"].includes(t)),
              "user shell has no admin navigation",
            );
          if (name.endsWith("sign-in")) {
            assert.deepEqual(geometry.nav, []);
            assert.equal(
              await page
                .getByRole("button", { name: "Sign out", exact: true })
                .count(),
              0,
            );
          }
          if (["editor", "statistics"].includes(name)) {
            assert.deepEqual(geometry.nav, []);
            assert.equal(
              await page
                .getByRole("link", { name: "Back to links", exact: true })
                .count(),
              1,
            );
          }
          observations.push({ name, theme, width, geometry });
          await page.screenshot({
            path: `${output}/${name}-${theme}-${width}.png`,
          });
          if (geometry.dialog) {
            await page
              .getByRole("button", {
                name: name === "events" ? "Back to links" : "Cancel",
                exact: true,
              })
              .click();
            assert.equal(await page.locator(".focused-dialog").count(), 0);
          }
        } finally {
          await page.close();
        }
      }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
await writeFile(
  `${output}/application-pages.json`,
  JSON.stringify({ observations, errors, requests }, null, 2),
);
console.log(
  JSON.stringify({
    cases: observations.length,
    errors,
    fixtureOnly: true,
    methods: [...new Set(requests.map((r) => r.method))],
  }),
);
assert.deepEqual(errors, []);
