import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.STORYBOOK_URL || "http://localhost:6006";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const directory =
  process.env.PRECISION_STORY_EVIDENCE || "test-results/precision-storybook";
await mkdir(directory, { recursive: true });
const index = await (await fetch(`${base}/index.json`)).json();
const ids = Object.values(index.entries)
  .filter((e) => e.type === "story")
  .map((e) => e.id);
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [],
  apiRequests = [],
  checked = [],
  geometry = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/*", (route) => {
  const req = route.request();
  if (new URL(req.url()).pathname.includes("/api/") || req.method() !== "GET") {
    apiRequests.push({ url: req.url(), method: req.method() });
    return route.abort();
  }
  return route.continue();
});
async function open(id) {
  await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`);
  await page.waitForFunction(
    () => document.querySelector("#storybook-root")?.childElementCount > 0,
  );
  assert.ok(
    !((await page.locator("body").getAttribute("class")) || "").includes(
      "sb-show-errordisplay",
    ),
    id,
  );
}
try {
  for (const id of ids) {
    await open(id);
    assert.doesNotMatch(
      await page.locator("#storybook-root").innerText(),
      /\bHumans\b|Human clicks|Human redirects/i,
      id,
    );
    checked.push(id);
  }
  assert.equal(checked.length, ids.length);
  await open("design-language--compare");
  assert.equal(await page.locator(".app-shell").count(), 1);
  assert.equal(
    await page
      .getByRole("columnheader", { name: "Clicks", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page.getByRole("heading", { name: "Links", exact: true }).count(),
    1,
  );
  assert.equal(await page.locator('th[colspan="6"]').count(), 1);
  for (const colorScheme of ["light", "dark"])
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [390, 420],
    ]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height });
      await page.getByText("+ Create link", { exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const bounds = await dialog.boundingBox();
      assert.ok(
        bounds.x >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= height,
      );
      await page
        .getByRole("button", { name: "Save link", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${directory}/selected-editor-${colorScheme}-${width}x${height}.png`,
      });
      geometry.push({
        id: "design-language--compare",
        colorScheme,
        width,
        height,
        bounds,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByText("+ Create link", { exact: true }).click();
  await page
    .getByLabel("Destination URL", { exact: true })
    .fill("https://example.test/story-proof");
  await page.getByLabel("Title", { exact: true }).fill("Story browser proof");
  await page.getByRole("button", { name: "Save link", exact: true }).click();
  await page.getByText("Story browser proof", { exact: true }).waitFor();
  const row = page.locator("tr").filter({ hasText: "Story browser proof" });
  await row.getByTitle("Delete link", { exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await row.waitFor({ state: "detached" });
  const nativeIds = ids.filter(
    (id) =>
      id.startsWith("public-redirect-gates--") && !id.endsWith("not-found"),
  );
  assert.ok(nativeIds.length >= 3);
  for (const id of nativeIds) {
    await open(id);
    const frame = page.frameLocator('iframe[title="Native public page"]');
    await frame.getByRole("heading", { level: 1 }).waitFor();
    for (const colorScheme of ["light", "dark"])
      for (const [width, height] of [
        [1440, 900],
        [390, 420],
      ]) {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width, height });
        const result = await frame.locator("body").evaluate((e) => ({
          font: getComputedStyle(e).fontFamily,
          bg: getComputedStyle(e).backgroundColor,
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert.ok(result.font.includes("system-ui"));
        assert.ok(result.scroll <= result.width);
        geometry.push({ id, colorScheme, width, height, ...result });
        await page.screenshot({
          path: `${directory}/${id}-${colorScheme}-${width}.png`,
        });
      }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
  const receipt = {
    status: "PASS",
    storyCount: ids.length,
    checked,
    geometry,
    actualProductionComponents: true,
    nativeSharedTemplates: true,
    errors,
    apiRequests,
  };
  await writeFile(
    `${directory}/receipt.json`,
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      storyCount: ids.length,
      nativeIds,
      errors,
      apiRequests,
    }),
  );
} finally {
  await browser.close();
}
