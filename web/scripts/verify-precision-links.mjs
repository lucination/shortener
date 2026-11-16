import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
const base = process.env.PRECISION_BASE || "http://localhost:6012";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext();
assert.ok(
  process.env.PRECISION_SESSION_FILE,
  "explicit task-owned session file required",
);
await context.addCookies([
  {
    name: "short_session",
    value: (await readFile(process.env.PRECISION_SESSION_FILE, "utf8")).trim(),
    url: base,
  },
]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const observations = [];
await mkdir("test-results/precision", { recursive: true });
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
  await page
    .getByRole("columnheader", { name: "Clicks", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("link", { name: /admin/i }).count(), 0);
  for (const colorScheme of ["light", "dark"])
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [390, 420],
    ]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height });
      if (width === 390) {
        const label =
          "Partner resources and a deliberately long reference title";
        const identity = page.getByText(label, { exact: true });
        assert.ok((await identity.boundingBox()).width <= 160);
        assert.equal(await identity.getAttribute("title"), label);
        await page
          .locator("tr")
          .filter({ hasText: label })
          .getByTitle("Edit link", { exact: true })
          .click();
        assert.equal(
          await page.getByLabel("Title", { exact: true }).inputValue(),
          label,
        );
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page
          .getByRole("heading", { name: "Links", exact: true })
          .waitFor();
      }
      await page.getByText("+ Create link", { exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const geometry = await dialog.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          height: r.height,
          scroll: e.scrollHeight,
          client: e.clientHeight,
          font: getComputedStyle(e).fontFamily,
        };
      });
      assert.ok(
        geometry.x >= 0 &&
          geometry.right <= width &&
          geometry.y >= 0 &&
          geometry.bottom <= height,
        JSON.stringify(geometry),
      );
      assert.ok(geometry.font.includes("system-ui"));
      await page
        .getByLabel("Destination URL", { exact: true })
        .fill("https://example.test/precision-browser");
      await page.getByLabel("Click limit", { exact: true }).fill("150");
      const save = page.getByRole("button", { name: "Save link", exact: true });
      await save.scrollIntoViewIfNeeded();
      const saveBounds = await save.boundingBox();
      assert.ok(
        saveBounds.x >= 0 &&
          saveBounds.x + saveBounds.width <= width &&
          saveBounds.y >= 0 &&
          saveBounds.y + saveBounds.height <= height,
      );
      await page.screenshot({
        path: `test-results/precision/editor-${colorScheme}-${width}x${height}.png`,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
      if (width === 390 && height === 420) {
        await page.getByText("+ Create link", { exact: true }).click();
        await page
          .getByLabel("Destination URL", { exact: true })
          .fill("https://example.test/short-height-proof");
        const title = `Short-height ${colorScheme} proof`;
        await page.getByLabel("Title", { exact: true }).fill(title);
        await page
          .getByRole("button", { name: "Save link", exact: true })
          .click();
        const row = page.locator("tr").filter({ hasText: title });
        await row.waitFor();
        await row.getByTitle("Delete link", { exact: true }).click();
        await page
          .getByRole("button", { name: "Confirm", exact: true })
          .click();
        await row.waitFor({ state: "detached" });
      }
      assert.ok(
        (await page.evaluate(() => document.documentElement.scrollWidth)) <=
          width,
      );
      observations.push({ colorScheme, width, height, ...geometry });
      await page.screenshot({
        path: `test-results/precision/links-${colorScheme}-${width}x${height}.png`,
      });
    }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText("+ Create link", { exact: true }).click();
  await page
    .getByLabel("Destination URL", { exact: true })
    .fill("https://example.test/precision-browser");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Browser persistence proof");
  await page.getByRole("button", { name: "Save link", exact: true }).click();
  await page.getByText("Browser persistence proof", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Browser persistence proof", { exact: true }).waitFor();
  const row = page
    .locator("tr")
    .filter({ hasText: "Browser persistence proof" });
  await row.getByTitle("Edit link", { exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Browser edited proof");
  await page.getByRole("button", { name: "Save link", exact: true }).click();
  await page.getByText("Browser edited proof", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("Browser edited proof", { exact: true }).waitFor();
  const edited = page.locator("tr").filter({ hasText: "Browser edited proof" });
  await edited.getByTitle("View statistics", { exact: true }).click();
  await page.getByText("Clicks per day", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert(new URL(page.url()).pathname.endsWith("/statistics"));
  await page
    .getByRole("button", { name: "Back to links", exact: true })
    .click();
  await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
  await edited.getByTitle("View events", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page
    .getByRole("button", { name: "Back to links", exact: true })
    .click();
  await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
  await edited.getByTitle("Delete link", { exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await page
    .getByText("Browser edited proof", { exact: true })
    .waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  const receipt = {
    status: "PASS",
    base,
    observations,
    persistence: true,
    createEditDelete: true,
    statsPageAndEventsDialog: true,
    errors,
  };
  await writeFile(
    "test-results/precision/links-browser.json",
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
} finally {
  await browser.close();
}
