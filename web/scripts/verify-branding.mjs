import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
const services = [];
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const [directory, port, title] of [
    ["build", 6010, "Sign in · Fieldlinks"],
    ["../admin/build", 6011, "Fieldlinks / Administration"],
  ]) {
    const server = spawn(
      "python3",
      [
        "-m",
        "http.server",
        String(port),
        "--bind",
        "127.0.0.1",
        "--directory",
        directory,
      ],
      { stdio: "ignore" },
    );
    services.push(server);
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}`);
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "static service ready");
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("PAGE_ERROR", e.message));
    page.on("requestfailed", (r) =>
      console.error("REQUEST_FAILED", r.url(), r.failure()),
    );
    // These isolated static artifacts have no API server. No writes or provider effects.
    await page.route("**/api/**", (r) =>
      r.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unauthorized",
          message: "authentication required",
        }),
      }),
    );
    // Admin assets retain their real /_ base on a tiny task-local static mount.
    if (port === 6011)
      await page.route("**/_/**", async (r) => {
        const path = new URL(r.request().url()).pathname.slice(2);
        if (path.startsWith("/api/"))
          return r.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
              code: "unauthorized",
              message: "authentication required",
            }),
          });
        const response = await fetch(`http://127.0.0.1:${port}${path || "/"}`);
        await r.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
    await page.goto(`http://127.0.0.1:${port}${port === 6011 ? "/_/" : "/"}`);
    await page
      .waitForFunction((expected) => document.title === expected, title, {
        timeout: 10000,
      })
      .catch(async (e) => {
        console.error(
          "DIAGNOSTIC",
          await page.title(),
          await page.locator("body").innerText(),
        );
        throw e;
      });
    await page
      .getByText(port === 6010 ? "Fieldlinks" : "Fieldlinks / ADMINISTRATION", {
        exact: true,
      })
      .first()
      .waitFor();
    assert.ok(!(await page.locator("body").innerText()).includes("Shortener"));
    console.log(
      JSON.stringify({
        directory,
        title: await page.title(),
        brand: "Fieldlinks",
        status: "PASS",
      }),
    );
    await page.close();
  }
} finally {
  await browser.close();
  await Promise.all(
    services.map(async (child) => {
      const closed = once(child, "close");
      child.kill("SIGTERM");
      await closed;
    }),
  );
}
