import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto("https://owickstrom.github.io/the-monospace-web/");
  await page.evaluate(() => document.fonts.ready);
  const styles = await page.evaluate(() =>
    Object.fromEntries(
      ["body", "h1", "h2", "strong", "th", "button"].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const style = getComputedStyle(element);
        return [
          selector,
          {
            family: style.fontFamily,
            weight: style.fontWeight,
            size: style.fontSize,
            lineHeight: style.lineHeight,
          },
        ];
      }),
    ),
  );
  await mkdir("test-results/screenshots", { recursive: true });
  await page.screenshot({
    path: "test-results/screenshots/reference-monospace-web.png",
  });
  await writeFile(
    "test-results/reference.json",
    JSON.stringify(styles, null, 2),
  );
  console.log(JSON.stringify(styles));
} finally {
  await browser.close();
}
