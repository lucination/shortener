/** Actual task-local Rust daemon + production API adapter, read-only.
 * Does not fabricate responses, authenticate, send mail or mutate records. */
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.BACKEND_BASE ?? "http://127.0.0.1:3000";
assert(
  ["http://127.0.0.1:3000", "http://localhost:3000"].includes(origin),
  "Admitted task-local backend only",
);
const bundled = await build({
  entryPoints: ["src/lib/adapters/api.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createApi } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const api = createApi((path, init) =>
  fetch(new URL(String(path), origin), init),
);
const observed = [];
for (const [name, call] of [
  ["me", () => api.me()],
  ["links", () => api.links()],
  ["users", () => api.users()],
  ["usage", () => api.usage()],
]) {
  const result = await call();
  assert.equal(result.kind, "failed");
  assert.equal(result.error.kind, "http");
  assert([401, 403].includes(result.error.status));
  observed.push({ name, ...result });
}
const root = await fetch(origin);
const html = await root.text();
assert(
  root.ok && html.includes("/_app/"),
  "Loco must serve the real built SPA, not a placeholder",
);
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const pages = [];
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Send sign-in link", exact: true })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
      heading: getComputedStyle(document.querySelector(".app-shell h1"))
        .fontFamily,
      fontLoaded: document.fonts.check('500 16px "JetBrains Mono"'),
    }));
    assert(
      geometry.document <= viewport.width &&
        geometry.fontLoaded &&
        geometry.heading.includes("JetBrains Mono"),
    );
    await mkdir("test-results/screenshots", { recursive: true });
    await page.screenshot({
      path: `test-results/screenshots/live-spa-login-${viewport.width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Admin", exact: true }).click();
    await page.getByText("Administrator token", { exact: true }).waitFor();
    assert.equal(errors.length, 0);
    pages.push({
      viewport,
      geometry,
      pageErrors: errors,
      flow: "Actual daemon 401 -> SPA magic login -> admin login",
    });
    await page.close();
  }
} finally {
  await browser.close();
}
const evidence = {
  origin,
  observed,
  pages,
  scope:
    "Actual read-only Rust HTTP responses and real served SPA. Authenticated CRUD, magic email, and WebAuthn remain separate acceptance.",
};
await writeFile(
  "test-results/live-readonly.json",
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
