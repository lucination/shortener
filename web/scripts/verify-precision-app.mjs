// Run only against an admitted task-local backend and explicitly seeded test user.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
let nativeDestinationServer;
const nativeDestinationRequests = [];
const base = process.env.PRECISION_BASE;
assert.ok(
  base && new URL(base).hostname === "localhost",
  "explicit task-local origin required",
);
assert.ok(
  process.env.PRECISION_SESSION_FILE &&
    process.env.PRECISION_ADMIN_TOKEN &&
    process.env.PRECISION_EMAIL,
);
const directory =
  process.env.PRECISION_EVIDENCE_DIR || "test-results/precision-app";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  baseURL: base,
  permissions: ["clipboard-read", "clipboard-write"],
});
await context.addCookies([
  {
    name: "short_session",
    value: (await readFile(process.env.PRECISION_SESSION_FILE, "utf8")).trim(),
    url: base,
  },
]);
const page = await context.newPage();
const errors = [],
  checks = [],
  owned = [];
page.on("pageerror", (e) => errors.push(e.message));
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log("PASS", name);
};
const click = async (name) => {
  const target = page.getByRole("button", { name, exact: true });
  await (name === "Create link" ? target.first() : target).click();
};
const me = async () => (await context.request.get("/api/me")).json();
const links = async () =>
  (await (await context.request.get("/api/links")).json()).items;
const row = (title) => page.locator("tbody tr").filter({ hasText: title });
const alias = `precision-check-${Date.now()}`;
let main,
  imported = [];
try {
  await check(
    "complete link controls persist through real create, edit, reload and password removal",
    async () => {
      await page.goto("/");
      await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
      assert.equal((await me()).email, process.env.PRECISION_EMAIL);
      await click("Create link");
      await page
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.test/controlled?fixed=1");
      await page.getByLabel("Custom alias", { exact: true }).fill(alias);
      await page
        .getByLabel("Title", { exact: true })
        .fill("Control persistence proof");
      await page
        .getByLabel("Description", { exact: true })
        .fill("A retained description.");
      await page.getByLabel("Password", { exact: true }).fill("proof-password");
      await page
        .getByLabel("Expiration", { exact: true })
        .fill("2030-01-01T12:00");
      await page.getByLabel("Click limit", { exact: true }).fill("250");
      await page
        .getByLabel("Raw event retention (days)", { exact: true })
        .fill("30");
      await page
        .getByRole("combobox", { name: /Incoming query parameters/ })
        .selectOption("preserve");
      await page
        .getByLabel("Show preview before redirect", { exact: true })
        .check();
      await click("Save link");
      await row("Control persistence proof").waitFor();
      main = (await links()).find(
        (l) => l.title === "Control persistence proof",
      );
      owned.push(main.id);
      await row("Control persistence proof")
        .getByTitle("Copy address", { exact: true })
        .click();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        `https://${main.addresses[0].domain}/${alias}`,
      );
      assert.equal(main.click_limit, 250);
      assert.equal(main.retention_days, 30);
      assert.equal(main.password_protected, true);
      assert.equal(main.interstitial, true);
      assert.equal(main.query_mode, "preserve");
      assert.ok(main.expires_at.startsWith("2030-01-01"));
      await page.reload();
      await row("Control persistence proof")
        .getByTitle("Edit link", { exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Click limit", { exact: true }).inputValue(),
        "250",
      );
      assert.equal(
        await page
          .getByLabel("Raw event retention (days)", { exact: true })
          .inputValue(),
        "30",
      );
      assert.ok(
        await page.getByLabel("Custom alias", { exact: true }).isDisabled(),
      );
      await page
        .getByLabel("Title", { exact: true })
        .fill("Edited control proof");
      await click("Save link");
      await row("Edited control proof")
        .getByTitle("Edit link", { exact: true })
        .click();
      await click("Remove existing password");
      assert.equal(await page.getByRole("dialog").count(), 1);
      await click("Confirm");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await click("Cancel");
      await row("Edited control proof").waitFor();
      assert.equal(
        (await links()).find((l) => l.id === main.id).password_protected,
        false,
      );
    },
  );
  await check(
    "CSV import, search and all bulk operations retain exact selected identities",
    async () => {
      await click("Import / paste");
      await page.getByLabel("CSV file", { exact: true }).setInputFiles({
        name: "links.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `destination,alias\nhttps://example.test/file,${alias}-file`,
        ),
      });
      await page.getByText(`${alias}-file`, { exact: true }).waitFor();
      assert.ok(
        (
          await page.getByLabel("URLs / CSV", { exact: true }).inputValue()
        ).includes(`${alias}-file`),
      );
      await page
        .getByLabel("URLs / CSV", { exact: true })
        .fill(
          `destination,alias\nhttps://example.test/one,${alias}-one\nhttps://example.test/two,${alias}-two`,
        );
      await click("Create 2 links");
      await page
        .getByText("Created 2 links. Return to links to manage them.", {
          exact: true,
        })
        .waitFor();
      await click("Cancel");
      imported = (await links()).filter((l) =>
        l.addresses.some(
          (a) =>
            a.short_code === `${alias}-one` || a.short_code === `${alias}-two`,
        ),
      );
      assert.equal(imported.length, 2);
      owned.push(...imported.map((l) => l.id));
      const search = page.getByPlaceholder(
        "Search links, destinations, aliases…",
      );
      await search.fill(`${alias}-one`);
      assert.equal(await page.locator("tbody tr").count(), 1);
      await search.fill("");
      const select = async () => {
        for (const l of imported)
          await row(l.addresses[0].short_code).getByRole("checkbox").check();
      };
      for (const action of ["disable", "enable", "retention", "expiration"]) {
        await select();
        await click(action);
        if (action === "retention")
          await page.getByLabel("Retention days", { exact: true }).fill("14");
        if (action === "expiration")
          await page
            .getByLabel("Expiration", { exact: true })
            .fill("2031-01-02T12:00");
        await click("Confirm");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await row("Edited control proof").waitFor();
        const actual = await links();
        for (const l of imported) {
          const a = actual.find((a) => a.id === l.id);
          if (action === "retention") assert.equal(a.retention_days, 14);
          else if (action === "expiration")
            assert.ok(a.expires_at.startsWith("2031-01-02"));
          else assert.equal(a.enabled, action === "enable");
        }
        assert.equal(actual.find((l) => l.id === main.id).retention_days, 30);
      }
      await select();
      await click("delete");
      await click("Confirm");
      await row("Edited control proof").waitFor();
      for (const l of imported)
        assert.ok(!(await links()).some((a) => a.id === l.id));
    },
  );
  await check(
    "real click statistics and retained event dialogs work at phone and short height in both themes",
    async () => {
      const response = await context.request.post(`/v/${alias}/continue`, {
        headers: {
          Origin: base,
          "User-Agent": "Mozilla/5.0 Firefox/120.0 Linux",
        },
        maxRedirects: 0,
      });
      assert.equal(response.status(), 302);
      for (const colorScheme of ["light", "dark"])
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
          [390, 420],
        ]) {
          await page.emulateMedia({ colorScheme });
          await page.setViewportSize({ width, height });
          const table = page.locator(".table-scroll");
          await table.evaluate((e) => (e.scrollLeft = e.scrollWidth));
          await row("Edited control proof")
            .getByTitle("View statistics", { exact: true })
            .click();
          await page.getByText("Daily activity", { exact: true }).waitFor();
          assert.equal(await page.getByTestId("human-total").innerText(), "1");
          const geometry = await page
            .locator(".management-page")
            .evaluate((e) => {
              const r = e.getBoundingClientRect();
              const a = e
                .querySelector("input[type=date]")
                .getBoundingClientRect();
              const b = [...e.querySelectorAll("button")]
                .find((b) => b.textContent === "Apply dates")
                .getBoundingClientRect();
              return {
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
                aligned: Math.abs(a.bottom - b.bottom) <= 1,
              };
            });
          assert.ok(
            geometry.x >= 0 &&
              geometry.right <= width &&
              geometry.y >= 0 &&
              geometry.aligned,
            JSON.stringify(geometry),
          );
          await page.screenshot({
            path: `${directory}/stats-${colorScheme}-${width}x${height}.png`,
          });
          await click("Back to links");
        }
      await page.setViewportSize({ width: 1440, height: 900 });
      await row("Edited control proof")
        .getByTitle("View events", { exact: true })
        .click();
      await page.getByRole("cell", { name: /^Firefox/ }).waitFor();
      await click("Back to links");
    },
  );
  await check(
    "account retention persists and resident passkeys survive session revocation independently of email",
    async () => {
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      const { authenticatorId } = await cdp.send(
        "WebAuthn.addVirtualAuthenticator",
        {
          options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        },
      );
      await click("Account");
      await page
        .getByLabel("Default retention (days)", { exact: true })
        .fill("21");
      await click("Save retention");
      await page.getByText("Retention saved.", { exact: true }).waitFor();
      assert.equal((await me()).retention_days, 21);
      await page.reload();
      await click("Account");
      assert.equal(
        await page
          .getByLabel("Default retention (days)", { exact: true })
          .inputValue(),
        "21",
      );
      for (const colorScheme of ["light", "dark"])
        for (const [width, height] of [
          [1440, 900],
          [390, 844],
          [390, 420],
        ]) {
          await page.emulateMedia({ colorScheme });
          await page.setViewportSize({ width, height });
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          );
          await page.screenshot({
            path: `${directory}/account-${colorScheme}-${width}x${height}.png`,
          });
          await click("Save retention");
          await page.getByText("Retention saved.", { exact: true }).waitFor();
        }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page
        .getByLabel("New passkey name", { exact: true })
        .fill("Browser test key");
      await click("Add passkey");
      await page
        .getByText("Passkey added to your account.", { exact: true })
        .waitFor();
      assert.equal(
        (await cdp.send("WebAuthn.getCredentials", { authenticatorId }))
          .credentials.length,
        1,
      );
      await click("Sign out");
      await page.getByLabel("Email", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("Email", { exact: true }).inputValue(),
        "",
      );
      await click("Sign in with passkey");
      await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
      assert.equal((await me()).email, process.env.PRECISION_EMAIL);
      await click("Account");
      await click("Sign out everywhere");
      await click("Confirm");
      await page.getByLabel("Email", { exact: true }).waitFor();
      await click("Sign in with passkey");
      await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
      assert.equal((await me()).email, process.env.PRECISION_EMAIL);
    },
  );
  await check(
    "separate admin users, quotas, retention, suspension, deletion and reactivation use real actions",
    async () => {
      await page.goto("/_/");
      await page
        .getByLabel("Admin token", { exact: true })
        .fill(process.env.PRECISION_ADMIN_TOKEN);
      await click("Sign in");
      await page.getByRole("heading", { name: "Users", exact: true }).waitFor();
      assert.equal((await me()).email, process.env.PRECISION_EMAIL);
      const email = `${alias}@example.test`;
      await click("Add user");
      await page.getByLabel("Email address", { exact: true }).fill(email);
      await click("Confirm");
      await row(email).waitFor();
      const target = row(email);
      await target.locator("td").nth(2).getByRole("button").click();
      await page.getByLabel("Link quota", { exact: true }).fill("0");
      await click("Confirm");
      await target.getByRole("button", { name: "0", exact: true }).waitFor();
      await target.locator("td").nth(3).getByRole("button").click();
      await page.getByLabel("Retention days", { exact: true }).fill("14");
      await click("Confirm");
      await target
        .getByRole("button", { name: "14 days", exact: true })
        .waitFor();
      await page.setViewportSize({ width: 390, height: 420 });
      for (const label of [
        "Suspend",
        "Reactivate",
        "Sign out everywhere",
        "Soft delete",
        "Reactivate",
      ]) {
        await target.getByRole("button", { name: label, exact: true }).click();
        const bounds = await page.getByRole("dialog").boundingBox();
        assert.ok(
          bounds.x >= 0 &&
            bounds.x + bounds.width <= 390 &&
            bounds.y >= 0 &&
            bounds.y + bounds.height <= 420,
        );
        await click("Confirm");
        await target.waitFor();
        if (label === "Suspend")
          await target
            .getByRole("button", { name: "Reactivate", exact: true })
            .waitFor();
        else if (label === "Reactivate")
          await target
            .getByRole("button", { name: "Suspend", exact: true })
            .waitFor();
      }
      const users = await (await context.request.get("/_/api/users")).json();
      await page.setViewportSize({ width: 1440, height: 900 });
      const user = users.items.find((u) => u.email === email);
      assert.equal(user.link_quota, 0);
      assert.equal(user.retention_days, 14);
      assert.equal(user.suspended, false);
      assert.equal(user.deleted_at, null);
    },
  );
  await check(
    "admin links, usage and events remain separate read-only screens in light/dark desktop and phone layouts",
    async () => {
      for (const name of ["Links", "Usage", "Events"]) {
        await click(name);
        await page.getByRole("heading", { name, exact: true }).waitFor();
        assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
        assert.equal(
          await page.getByText("Create link", { exact: true }).count(),
          0,
        );
        for (const colorScheme of ["light", "dark"])
          for (const [width, height] of [
            [1440, 900],
            [390, 420],
          ]) {
            await page.emulateMedia({ colorScheme });
            await page.setViewportSize({ width, height });
            assert.ok(
              await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            );
            await page.screenshot({
              path: `${directory}/admin-${name}-${colorScheme}-${width}.png`,
            });
          }
      }
      await click("Sign out");
      await page.getByLabel("Admin token", { exact: true }).waitFor();
      assert.equal((await context.request.get("/api/me")).status(), 200);
      assert.equal((await context.request.get("/_/api/users")).status(), 403);
    },
  );
  await check(
    "native password and continue screens keep grants and redirects authoritative without JavaScript",
    async () => {
      nativeDestinationServer = createServer((request, response) => {
        nativeDestinationRequests.push({
          method: request.method,
          path: request.url,
          referer: request.headers.referer,
          cookiePresent: Boolean(request.headers.cookie),
        });
        response.writeHead(
          request.method === "GET" && request.url === "/native-destination"
            ? 200
            : 404,
          { "Content-Type": "text/plain" },
        );
        response.end("Owned acceptance destination.");
      });
      await new Promise((resolve) =>
        nativeDestinationServer.listen(0, "127.0.0.1", resolve),
      );
      const nativeDestination = `http://127.0.0.1:${nativeDestinationServer.address().port}/native-destination`;
      const created = await context.request.post("/api/links", {
        headers: { Origin: base },
        data: {
          destination: nativeDestination,
          alias: `${alias}-public`,
          title: "Native preview",
          password: "native-password",
          interstitial: true,
        },
      });
      assert.equal(created.status(), 201);
      owned.push((await created.json()).id);
      const anon = await browser.newContext({
        baseURL: base,
        javaScriptEnabled: false,
      });
      const p = await anon.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      try {
        for (const colorScheme of ["light", "dark"])
          for (const [width, height] of [
            [1440, 900],
            [390, 844],
            [390, 420],
          ]) {
            await p.emulateMedia({ colorScheme });
            await p.setViewportSize({ width, height });
            await p.goto(`/v/${alias}-public`);
            await p
              .getByRole("heading", { name: "Password required", exact: true })
              .waitFor();
            assert.ok(
              !(await p.locator("body").innerText()).includes(
                "native-destination",
              ),
            );
            assert.ok(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
              ),
            );
            assert.equal(
              await p
                .locator("input")
                .evaluate((e) => getComputedStyle(e).borderRadius),
              "4px",
            );
            await p.screenshot({
              path: `${directory}/public-password-${colorScheme}-${width}x${height}.png`,
            });
          }
        await p
          .getByLabel("Link password", { exact: true })
          .fill("wrong-password");
        await p.getByRole("button", { name: "Unlock", exact: true }).click();
        await p
          .getByRole("heading", { name: "Unable to unlock link", exact: true })
          .waitFor();
        await p.getByRole("link", { name: "Try again", exact: true }).click();
        await p
          .getByLabel("Link password", { exact: true })
          .fill("native-password");
        await p.getByRole("button", { name: "Unlock", exact: true }).click();
        await p
          .getByRole("heading", { name: "Native preview", exact: true })
          .waitFor();
        await p.getByText(nativeDestination, { exact: true }).waitFor();
        await p.getByRole("button", { name: "Continue", exact: true }).click();
        await p.waitForURL(nativeDestination);
        assert.deepEqual(
          nativeDestinationRequests.find(
            (request) => request.path === "/native-destination",
          ),
          {
            method: "GET",
            path: "/native-destination",
            referer: undefined,
            cookiePresent: false,
          },
        );
        const unavailableContext = await browser.newContext({ baseURL: base });
        try {
          const unavailable = await unavailableContext.newPage();
          unavailable.on("pageerror", (e) => errors.push(e.message));
          const response = await unavailable.goto("/not-a-real-link");
          assert.equal(response.status(), 404);
          await unavailable
            .getByRole("heading", { name: "Link not found.", exact: true })
            .waitFor();
          assert.equal(
            await unavailable
              .getByRole("button", { name: /^(Links|Account|Sign out)$/ })
              .count(),
            0,
          );
        } finally {
          await unavailableContext.close();
        }
      } finally {
        await anon.close();
      }
    },
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${directory}/receipt.json`,
    JSON.stringify({ status: "PASS", base, checks, owned, errors }, null, 2),
  );
  console.log(JSON.stringify({ status: "PASS", checks, owned, errors }));
} catch (e) {
  console.error("PAGE", await page.locator("body").innerText());
  throw e;
} finally {
  await browser.close();
  if (nativeDestinationServer)
    await new Promise((resolve) => nativeDestinationServer.close(resolve));
}
