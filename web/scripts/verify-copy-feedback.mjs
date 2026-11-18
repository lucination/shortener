import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

// Run only against an explicitly admitted, isolated demo with synthetic links.
assert.ok(process.env.COPY_DEMO_BASE, "explicit isolated demo URL required");
assert.ok(
  process.env.COPY_EVIDENCE_DIR,
  "explicit evidence directory required",
);
const base = process.env.COPY_DEMO_BASE;
const output = process.env.COPY_EVIDENCE_DIR;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const observations = [];
const geometry = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll("h1, .grid-table, .grid-table tr, .toolbar"),
    ].map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Links", exact: true }).waitFor();
  const links = await page.evaluate(
    async () => (await (await fetch("/api/links")).json()).items,
  );
  assert.ok(links.length >= 2, "two synthetic demo links required");
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 844 });
      const button = page
        .getByTitle("Copy short address", { exact: true })
        .nth(1);
      await button.scrollIntoViewIfNeeded();
      const row = button.locator("xpath=ancestor::tr");
      const label = await row.locator("strong").textContent();
      const link = links.find(
        (link) => (link.title || `Link #${link.id}`) === label,
      );
      assert.ok(link, `source row ${label}`);
      const expected = `https://${link.addresses[0].domain}/${link.addresses[0].short_code}`;
      const before = await geometry();
      await button.click();
      const feedback = page.locator(".toast");
      await feedback
        .getByText("Short address copied.", { exact: true })
        .waitFor();
      assert.equal(await feedback.count(), 1);
      assert.equal(await row.locator(".toast").count(), 1);
      const clipboard = await page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      assert.equal(clipboard, expected);
      const after = await geometry();
      assert.deepEqual(
        after,
        before,
        "copy must not move table, rows, heading or toolbars",
      );
      const popup = await feedback.boundingBox();
      const anchor = await button.boundingBox();
      assert.ok(popup.x >= 8 && popup.x + popup.width <= width - 8);
      assert.ok(popup.y >= 0 && popup.y + popup.height <= 844);
      assert.ok(
        Math.min(
          Math.abs(popup.y - anchor.y - anchor.height),
          Math.abs(anchor.y - popup.y - popup.height),
        ) <= 7,
      );
      const style = await feedback.evaluate((node) => ({
        position: getComputedStyle(node).position,
        background: getComputedStyle(node).backgroundColor,
      }));
      assert.equal(style.position, "fixed");
      assert.notEqual(style.background, "rgba(0, 0, 0, 0)");
      await page.screenshot({ path: `${output}/${colorScheme}-${width}.png` });
      await feedback.waitFor({ state: "detached", timeout: 5000 });
      assert.deepEqual(
        await geometry(),
        before,
        "dismissal must not shift layout",
      );
      observations.push({
        colorScheme,
        width,
        label,
        expected,
        clipboard,
        before,
        after,
        popup,
        anchor,
        style,
        dismissed: true,
      });
    }
  }
  await page.evaluate(() => {
    window.__originalCopy = navigator.clipboard.writeText.bind(
      navigator.clipboard,
    );
    navigator.clipboard.writeText = () =>
      Promise.reject(new DOMException("Denied", "NotAllowedError"));
  });
  const button = page.getByTitle("Copy short address", { exact: true }).first();
  await button.scrollIntoViewIfNeeded();
  const before = await geometry();
  await button.click();
  await page
    .getByText("Clipboard unavailable. Select and copy the short address.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByText("Short address copied.", { exact: true }).count(),
    0,
  );
  assert.deepEqual(await geometry(), before);
  await page.locator(".toast").waitFor({ state: "detached", timeout: 6500 });
  await page.evaluate(() => {
    navigator.clipboard.writeText = window.__originalCopy;
  });
  assert.deepEqual(errors, []);
  const receipt = {
    status: "PASS",
    base,
    actualBrowserClipboard: true,
    observations,
    rejection: {
      injectedBrowserRejection: true,
      falseSuccess: false,
      noLayoutShift: true,
      dismissed: true,
    },
    errors,
  };
  await writeFile(`${output}/browser.json`, JSON.stringify(receipt, null, 2));
  console.log(
    JSON.stringify({
      status: receipt.status,
      sizes: observations.map(({ colorScheme, width }) => ({
        colorScheme,
        width,
      })),
      rejection: receipt.rejection,
    }),
  );
} finally {
  await browser.close();
}
