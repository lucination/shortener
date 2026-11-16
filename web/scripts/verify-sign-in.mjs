import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";
const output = process.env.EVIDENCE_DIR ?? "test-results/sign-in";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [],
  api = [],
  observations = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (req) => {
    if (new URL(req.url()).pathname.includes("/api/")) api.push(req.url());
  });
  await page.addInitScript(() => {
    navigator.credentials.get = () => {
      throw new Error("Story invoked a real passkey ceremony");
    };
  });
  const open = async (story = "sign-in") => {
    await page.goto(
      `${base}/iframe.html?id=precision-sign-in--${story}&viewMode=story`,
    );
    await page.locator(".si-page").waitFor();
  };
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [390, 420],
    ]) {
      await page.setViewportSize({ width, height });
      await open();
      assert.equal(await page.locator(".si-page h1").innerText(), "Sign in");
      assert.equal((await page.locator(".si-page").boundingBox()).x, 0);
      assert.equal(await page.title(), "Sign in · Shortener");
      const geometry = await page.evaluate(() => {
        const selectors = [
          ".si-panel",
          "input",
          "button.dl-primary",
          ".si-passkey > button",
        ];
        return {
          width: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          background: getComputedStyle(document.querySelector(".si-page"))
            .backgroundColor,
          controls: selectors.map((s) => {
            const r = document.querySelector(s).getBoundingClientRect();
            return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
          }),
        };
      });
      assert.ok(geometry.documentWidth <= width, JSON.stringify(geometry));
      assert.ok(
        geometry.controls.every(
          (r) => r.x >= 0 && r.right <= width && r.y >= 0 && r.bottom <= height,
        ),
        JSON.stringify(geometry),
      );
      assert.equal(
        geometry.background,
        theme === "dark" ? "oklch(0.21 0.006 285.885)" : "oklch(0.985 0 0)",
      );
      observations.push({ theme, width, height, ...geometry });
      await page.screenshot({
        path: `${output}/${theme}-${width}x${height}.png`,
      });
      // Passkey does not validate or require an email.
      await page
        .getByRole("button", { name: "Sign in with passkey", exact: true })
        .click();
      await page.getByText("Waiting for passkey…", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("Email", { exact: true }).inputValue(),
        "",
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByText(/Passkey sign-in was cancelled/).waitFor();
      await page
        .getByLabel("Email", { exact: true })
        .fill("reader@example.org");
      await page
        .getByRole("button", { name: "Send sign-in link", exact: true })
        .click();
      assert.ok(
        await page
          .getByRole("button", { name: "Sending link…", exact: true })
          .isDisabled(),
      );
      assert.ok(
        await page
          .getByRole("button", { name: "Sign in with passkey", exact: true })
          .isDisabled(),
      );
      await page.getByText(/If this email belongs/).waitFor();
      assert.equal(
        await page.getByLabel("Email", { exact: true }).inputValue(),
        "reader@example.org",
      );
      await page
        .getByRole("button", { name: "Send another link", exact: true })
        .click();
      await page.getByText(/If this email belongs/).waitFor();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const story of [
    "sending",
    "sent",
    "email-error",
    "passkey-pending",
    "passkey-cancelled",
    "passkey-error",
    "custom-name",
  ]) {
    await open(story);
    await page.screenshot({ path: `${output}/${story}.png` });
    if (story === "email-error") {
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await page.getByText(/If this email belongs/).waitFor();
      assert.equal(
        await page.getByLabel("Email", { exact: true }).inputValue(),
        "reader@example.org",
      );
    }
    if (story === "passkey-error") {
      await page
        .getByRole("button", { name: "Sign in with passkey", exact: true })
        .click();
      await page.getByText("Waiting for passkey…", { exact: true }).waitFor();
      await page.getByText(/Unable to sign in with a passkey/).waitFor();
    }
    if (story === "custom-name") {
      assert.equal(await page.title(), "Sign in · Fieldlinks");
      assert.equal(await page.locator(".dl-brand").innerText(), "Fieldlinks");
    }
  }
  const index = await (await fetch(`${base}/index.json`)).json();
  assert.ok(index.entries["precision-sign-in--sign-in"]);
  const iframe = await (await fetch(`${base}/iframe.html`)).arrayBuffer();
  const disk = await readFile(
    new URL("../storybook-static/iframe.html", import.meta.url),
  );
  const hash = (b) => createHash("sha256").update(Buffer.from(b)).digest("hex");
  assert.equal(hash(iframe), hash(disk));
  assert.deepEqual(api, []);
  assert.deepEqual(errors, []);
  const result = {
    status: "PASS",
    story: "precision-sign-in--sign-in",
    apiRequests: api,
    pageErrors: errors,
    servedIframeSha256: hash(disk),
    observations,
  };
  await writeFile(`${output}/receipt.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
