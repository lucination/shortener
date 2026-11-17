import { nativePopup } from "./access-token-native-popup.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createLink } from "../../extension/compiled/extension/src/api.js";
const base = process.env.TOKENS_BASE;
assert.equal(new URL(base).hostname, "localhost");
const directory = process.env.TOKENS_EVIDENCE || "test-results/access-tokens";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  ignoreDefaultArgs: ["--disable-back-forward-cache"],
});
const observations = [];
try {
  for (const theme of ["light", "dark"])
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      try {
        await context.addCookies([
          {
            name: "short_session",
            value: process.env.TOKENS_SESSION,
            url: base,
          },
        ]);
        const page = await context.newPage();
        await page.goto(base);
        await page
          .getByRole("button", { name: "Account", exact: true })
          .click();
        const section = page.getByTestId("access-token-section");
        await expect(
          section.getByText("No access tokens.", { exact: true }),
        ).toBeVisible();
        const name = section.getByLabel("Token name", { exact: true });
        await name.fill("");
        await section
          .getByRole("button", { name: "Create access token" })
          .click();
        await expect(
          section.getByText(
            "token name must be 1..80 characters without control characters",
          ),
        ).toBeVisible();
        await name.fill(`Browser ${theme} ${width}`);
        assert.equal(
          await section
            .getByRole("combobox", { name: /Expires in/ })
            .inputValue(),
          "90",
        );
        await section
          .getByRole("button", { name: "Create access token" })
          .click();
        const secretInput = section.getByLabel("New access token", {
          exact: true,
        });
        await expect(secretInput).toBeVisible();
        const token = await secretInput.inputValue();
        assert.match(token, /^short_at_[0-9a-f]{64}$/);
        await page.evaluate(() => {
          window.originalWrite = navigator.clipboard.writeText.bind(
            navigator.clipboard,
          );
          navigator.clipboard.writeText = async () => {
            throw Error("denied fixture");
          };
        });
        await section.getByRole("button", { name: "Copy token" }).click();
        await expect(
          section.getByText(
            "Token could not be copied. Select it and copy manually.",
          ),
        ).toBeVisible();
        await page.evaluate(
          () => (navigator.clipboard.writeText = window.originalWrite),
        );
        await section.getByRole("button", { name: "Copy token" }).click();
        await expect(section.getByText("Token copied.")).toBeVisible();
        assert.equal(
          await page.evaluate(() => navigator.clipboard.readText()),
          token,
        );
        // Actual shipped extension API adapter, cookies omitted, against native server.
        const link = await createLink(
          { service: base, token },
          {
            destination: "https://example.test/article",
            title: "Native extension acceptance",
          },
        );
        assert.equal(link.owner_id, 1);
        if (theme === "light" && width === 1280) {
          await page.goto(`${base}/native-navigation-fixture-not-found`);
          await page.goBack();
          await expect(
            page.getByLabel("New access token", { exact: true }),
          ).toHaveCount(0);
          await page
            .getByRole("button", { name: "Account", exact: true })
            .click();
        } else {
          await section
            .getByRole("button", { name: "Done", exact: true })
            .click();
          await expect(secretInput).toHaveCount(0);
        }
        await page.getByRole("button", { name: "Links", exact: true }).click();
        await page
          .getByRole("button", { name: "Account", exact: true })
          .click();
        await expect(
          section.getByText("Native extension acceptance"),
        ).toHaveCount(0);
        await expect(
          section.getByText(`Browser ${theme} ${width}`, { exact: true }),
        ).toBeVisible();
        await expect(section.getByText("Last used: Never")).toHaveCount(0);
        const geometry = await section.evaluate((node) => ({
          width: node.getBoundingClientRect().width,
          font: getComputedStyle(node).font,
          overflow: document.documentElement.scrollWidth > innerWidth,
          controls: [...node.querySelectorAll("button,input,select")].map(
            (n) => ({
              font: getComputedStyle(n).font,
              radius: getComputedStyle(n).borderRadius,
              right: n.getBoundingClientRect().right,
            }),
          ),
        }));
        assert.equal(geometry.overflow, false);
        assert(geometry.font.includes("system-ui"));
        assert(geometry.controls.every((c) => c.right <= width + 1));
        await page.screenshot({
          path: `${directory}/account-${theme}-${width}.png`,
          fullPage: true,
        });
        await section
          .getByRole("button", { name: "Revoke", exact: true })
          .click();
        await expect(
          section.getByText("No access tokens.", { exact: true }),
        ).toBeVisible();
        await assert.rejects(
          () =>
            createLink(
              { service: base, token },
              { destination: "https://example.test/revoked" },
            ),
          /Access token not accepted/,
        );
        observations.push({
          theme,
          width,
          geometry,
          createdOwner: link.owner_id,
          clipboard: "real readback matched",
          revoked: true,
        });
      } finally {
        await context.close();
      }
    }
  // Hold a real issuance response after the native mutation, then leave Account.
  const context = await browser.newContext();
  try {
    await context.addCookies([
      { name: "short_session", value: process.env.TOKENS_SESSION, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    let release;
    const held = new Promise((r) => (release = r));
    let observed;
    const transmitted = new Promise((r) => (observed = r));
    await page.route("**/api/account/tokens", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      observed();
      await held;
      await route.fulfill({ response });
    });
    await page
      .getByLabel("Token name", { exact: true })
      .fill("Held native issuance");
    await page.getByRole("button", { name: "Create access token" }).click();
    await transmitted;
    await page.getByRole("button", { name: "Links", exact: true }).click();
    release();
    await page.waitForTimeout(200);
    await expect(
      page.getByLabel("New access token", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await expect(
      page.getByText("Held native issuance", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("New access token", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    observations.push({
      heldNativeIssuance: "no stale secret reveal after navigation",
    });
  } finally {
    await context.close();
  }
  await writeFile(
    `${directory}/browser-observations.json`,
    JSON.stringify(observations, null, 2),
  );
  console.log(
    "Native Account creation, error, real clipboard, extension POST, metadata, revoke and stale-response checks passed; desktop/phone, light/dark.",
  );
} finally {
  await browser.close();
}
await nativePopup(base, process.env.TOKENS_SESSION, directory);
