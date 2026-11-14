/** Reversible actual-source edit probe. The caller applies/restores the edit after READY.
 * Local gateway WebSocket transport avoids the private TLS-edge login in this box browser;
 * no API or HMR messages are mocked. External TLS/bearer-link verification is parent-owned. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:3000";
const html = await (await fetch(origin)).text();
assert(
  html.includes("/@vite/client"),
  "Integrated gateway is not serving the Vite dev shell yet",
);
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url, protocols) {
        const target = new URL(String(url), location.href);
        const hmr =
          target.hostname === "localhost" &&
          target.pathname === "/__frontend_hmr";
        if (hmr) {
          target.protocol = "ws:";
          target.host = "127.0.0.1:3000";
        }
        super(target, protocols);
        if (hmr)
          this.addEventListener("open", () => (window.__hmrProbeOpen = true));
      }
    };
  });
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Send sign-in link", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => window.__hmrProbeOpen === true,
    {},
    { timeout: 30000 },
  );
  await mkdir("test-results/screenshots", { recursive: true });
  await page.screenshot({ path: "test-results/screenshots/hmr-before.png" });
  console.log(
    "READY: actual gateway WebSocket connected; apply reversible AuthPanel text/CSS edit now",
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector(".app-shell h1")
        ?.textContent?.includes("HMR probe") &&
      getComputedStyle(document.querySelector(".app-shell")).outlineColor ===
        "rgb(123, 45, 67)",
    {},
    { timeout: 120000 },
  );
  const changed = await page.evaluate(() => ({
    heading: document.querySelector(".app-shell h1").textContent,
    outline: getComputedStyle(document.querySelector(".app-shell"))
      .outlineColor,
  }));
  await page.screenshot({ path: "test-results/screenshots/hmr-edited.png" });
  console.log(
    "EDIT OBSERVED: text and CSS updated without navigation; restore source now",
  );
  await page.waitForFunction(
    () =>
      document.querySelector(".app-shell h1")?.textContent?.trim() ===
        "A shorter way in." &&
      getComputedStyle(document.querySelector(".app-shell")).outlineStyle ===
        "none",
    {},
    { timeout: 120000 },
  );
  assert.equal(
    navigations,
    1,
    "HMR must update the existing page, not require navigation/reload",
  );
  const result = {
    transport:
      "Actual local gateway HTTP + WebSocket; external wss destination locally routed to same gateway for private-edge isolation",
    changed,
    restored: true,
    navigations,
  };
  await writeFile("test-results/hmr.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
