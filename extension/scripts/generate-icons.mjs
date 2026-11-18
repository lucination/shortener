/** Optional regeneration using the existing exact-locked Playwright Chromium.
 * Normal builds copy committed PNGs; no browser/runtime dependency is added.
 */
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const directory = new URL("../static/icons/", import.meta.url);
const svg = await readFile(new URL("shortener.svg", directory), "utf8");
const browser = await chromium.launch({
  channel: "chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route("**/*", (route) => route.abort());
  for (const size of [16, 32, 48, 96, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      "<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>" +
        svg,
    );
    await page.locator("svg").evaluate((node, size) => {
      node.setAttribute("width", String(size));
      node.setAttribute("height", String(size));
    }, size);
    await page.screenshot({
      path: fileURLToPath(new URL(`icon-${size}.png`, directory)),
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
console.log(
  "Regenerated transparent 16/32/48/96/128 PNGs from existing app mark SVG",
);
