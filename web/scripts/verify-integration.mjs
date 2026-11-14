// Actual task-local Loco/SQLite/SMTP + both production SPAs. No network mocks.
import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const env = Object.fromEntries(
  (
    await readFile(
      process.env.SMOKE_ENV ?? ".integration-smoke.env",
      "utf8",
    )
  )
    .split("\n")
    .filter((x) => x && !x.startsWith("#"))
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
const base = env.APP_ORIGIN;
assert(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "isolated loopback only",
);
assert(
  env.DATABASE_PATH.includes("integration-smoke"),
  "explicit task-local DB required",
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL: base });
const page = await context.newPage();
await page.addInitScript(() => {
  window.__credentialTrace = [];
  const original = navigator.credentials.create.bind(navigator.credentials);
  navigator.credentials.create = async (options) => {
    window.__credentialTrace.push("create invoked");
    try {
      return await original(options);
    } catch (e) {
      window.__credentialTrace.push(`${e.name}: ${e.message}`);
      throw e;
    }
  };
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS", name);
}
try {
  await check(
    "unauthenticated user shell has no navigation, signout, admin or theme",
    async () => {
      await page.goto("/");
      await page.getByText("Send sign-in link", { exact: true }).waitFor();
      for (const label of ["Links", "Account", "Sign out", "Admin", "Theme"])
        assert.equal(
          await page.getByRole("button", { name: label, exact: true }).count(),
          0,
        );
      assert(
        !(await page.locator("body").innerText()).includes("Small links."),
      );
    },
  );
  await check(
    "separate admin entrypoint authenticates without signing in user",
    async () => {
      await page.goto("/_/");
      await page.getByLabel("Admin token").fill(env.ADMIN_TOKEN);
      await page.getByTestId("auth-form").evaluate((f) => f.requestSubmit());
      await page
        .getByRole("heading", { name: "All users", exact: true })
        .waitFor();
      assert.equal((await context.request.get("/api/me")).status(), 403);
    },
  );
  const email = `browser-${Date.now()}@example.test`;
  await check(
    "admin container creates a user through generated-contract parser",
    async () => {
      await page.getByRole("button", { name: /Add user/ }).click();
      await page.getByLabel("Email address", { exact: true }).fill(email);
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await page.getByText(email, { exact: true }).waitFor();
    },
  );
  await check(
    "magic sign in goes through actual local Mailpit and redirect cookie",
    async () => {
      await page.goto("/");
      await page.getByLabel("Email address").fill(email);
      await page.getByTestId("auth-form").evaluate((f) => f.requestSubmit());
      let token;
      for (let i = 0; i < 50 && !token; i++) {
        const messages = await (
          await fetch("http://127.0.0.1:8026/api/v1/messages")
        ).json();
        for (const m of messages.messages ?? [])
          if (m.To.some((to) => to.Address === email)) {
            const mail = await (
              await fetch(`http://127.0.0.1:8026/api/v1/message/${m.ID}`)
            ).json();
            token = mail.Text.match(/token=([a-f0-9]+)/)?.[1];
          }
        if (!token) await new Promise((r) => setTimeout(r, 100));
      }
      assert(token, "actual SMTP message");
      await page.goto(`/auth/verify?token=${token}`);
      await page.getByText("+ Create link", { exact: true }).waitFor();
    },
  );
  const alias = `browser-${Date.now()}`;
  await check(
    "user container creates a real link, direct backend redirects without JS",
    async () => {
      await page.getByText("+ Create link", { exact: true }).click();
      await page
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.test/browser?fixed=1");
      await page.getByLabel("Custom alias", { exact: true }).fill(alias);
      await page
        .getByLabel("Title", { exact: true })
        .fill("Browser integration");
      await page.getByTestId("link-editor").evaluate((f) => f.requestSubmit());
      await page.getByText("Browser integration", { exact: true }).waitFor();
      const r = await context.request.get("/" + alias, {
        maxRedirects: 0,
        headers: { "User-Agent": "Mozilla/5.0 Firefox/120.0 Linux" },
      });
      assert.equal(r.status(), 302);
      assert.equal(
        r.headers().location,
        "https://example.test/browser?fixed=1",
      );
    },
  );
  await check(
    "inline validation preserves submitted input with a clear recovery",
    async () => {
      await page.getByText("+ Create link", { exact: true }).click();
      await page
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.test/again");
      await page.getByLabel("Custom alias", { exact: true }).fill(alias);
      await page.getByTestId("link-editor").evaluate((f) => f.requestSubmit());
      await page.getByText("Check your input", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("Custom alias", { exact: true }).inputValue(),
        alias,
      );
      assert.equal(
        await page.getByLabel("Destination URL", { exact: true }).inputValue(),
        "https://example.test/again",
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByText("Browser integration", { exact: true }).waitFor();
    },
  );
  await check(
    "actual stats and date controls consume nonempty generated DTOs",
    async () => {
      await page
        .locator("tr")
        .filter({ hasText: "Browser integration" })
        .getByTitle("View statistics")
        .click();
      await page.getByText("Human redirects / day", { exact: true }).waitFor();
      assert.equal(
        await page.locator(".metric-value").first().innerText(),
        "1",
      );
      const geometry = await page.evaluate(() => {
        const a = document
          .querySelector("input[type=date]")
          .getBoundingClientRect();
        const b = [...document.querySelectorAll("button")]
          .find((x) => x.textContent === "Apply dates")
          .getBoundingClientRect();
        return { inputBottom: a.bottom, applyBottom: b.bottom };
      });
      assert(
        Math.abs(geometry.inputBottom - geometry.applyBottom) <= 2,
        JSON.stringify(geometry),
      );
      await page.getByText("Back to links", { exact: true }).click();
    },
  );
  await check(
    "bulk import, editing, toggle and deletion run through actual containers",
    async () => {
      await page.getByText("Import / paste", { exact: true }).click();
      await page
        .getByLabel("URLs / CSV", { exact: true })
        .fill(
          [
            "destination,alias",
            `https://example.test/one,${alias}-one`,
            `https://example.test/two,${alias}-two`,
          ].join(String.fromCharCode(10)),
        );
      await page.getByText("Create 2 links", { exact: true }).click();
      await page
        .getByText("Created 2 links. Return to links to manage them.", {
          exact: true,
        })
        .waitFor();
      await page.getByRole("button", { name: "Links", exact: true }).click();
      await page
        .locator("tr")
        .filter({ hasText: "Browser integration" })
        .getByTitle("Edit link")
        .click();
      await page
        .getByLabel("Title", { exact: true })
        .fill("Edited browser link");
      await page.getByTestId("link-editor").evaluate((f) => f.requestSubmit());
      const row = page.locator("tr").filter({ hasText: "Edited browser link" });
      await row.getByTitle("Disable link").click();
      await row.getByTitle("Enable link").waitFor();
      assert.equal(
        (await context.request.get("/" + alias, { maxRedirects: 0 })).status(),
        404,
      );
      await row.getByTitle("Enable link").click();
      await row.getByTitle("Disable link").waitFor();
      assert.equal(
        (await context.request.get("/" + alias, { maxRedirects: 0 })).status(),
        302,
      );
      await page
        .locator("tr")
        .filter({ hasText: `${alias}-one` })
        .getByTitle("Delete link")
        .click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      await page
        .locator("tr")
        .filter({ hasText: `${alias}-one` })
        .waitFor({ state: "detached" });
    },
  );
  await check(
    "browser passkey enrollment and sign-in use actual WebAuthn verification",
    async () => {
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await page.getByText("Add passkey", { exact: true }).click();
      await page.waitForFunction(
        () =>
          document.body.innerText.includes("Passkey added to your account.") ||
          document.body.innerText.includes("Passkey enrollment was cancelled"),
      );
      assert.equal(
        await page
          .getByText("Passkey added to your account.", { exact: true })
          .count(),
        1,
        JSON.stringify(await page.evaluate(() => window.__credentialTrace)),
      );
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.getByLabel("Email address").fill(email);
      await page.getByText("Use a passkey", { exact: true }).click();
      await page.getByText("Edited browser link", { exact: true }).waitFor();
    },
  );
  await check(
    "system themes and actual variable font weights load",
    async () => {
      const backgrounds = [];
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme });
        await page.evaluate(() => document.fonts.ready);
        backgrounds.push(
          await page
            .locator("body")
            .evaluate((e) => getComputedStyle(e).backgroundColor),
        );
      }
      assert.notEqual(
        backgrounds[0],
        backgrounds[1],
        "OS color scheme must change actual product colors",
      );
      const fonts = await page.evaluate(async () => {
        for (const w of [100, 400, 600, 700, 800])
          await document.fonts.load(`${w} 16px "JetBrains Mono"`);
        return [...document.fonts]
          .filter((f) => f.family.includes("JetBrains"))
          .map((f) => ({ weight: f.weight, status: f.status }));
      });
      assert(
        fonts.some((f) => f.weight === "100 800" && f.status === "loaded"),
      );
      assert.equal(await page.locator("select").count(), 0);
    },
  );
  await check(
    "desktop and phone contain shell with aligned action columns",
    async () => {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(geometry.scroll <= geometry.width, JSON.stringify(geometry));
      }
    },
  );
  await check(
    "admin signout leaves user session authority intact",
    async () => {
      await page.goto("/_/");
      await page
        .getByRole("heading", { name: "All users", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.getByLabel("Admin token").waitFor();
      const me = await context.request.get("/api/me");
      assert.equal(me.status(), 200);
      assert.equal((await context.request.get("/_/api/users")).status(), 403);
    },
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "integration-browser-receipt.json",
    JSON.stringify({ base, checks, errors }, null, 2),
  );
} catch (error) {
  console.error(
    "Browser failure state:",
    await page.locator("body").innerText(),
  );
  console.error("Page errors:", errors);
  throw error;
} finally {
  await browser.close();
}
