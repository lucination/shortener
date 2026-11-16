import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function verifySignedOut(browser, base, appName, errors = []) {
  assert.equal(
    new URL(base).hostname,
    "localhost",
    "task-local backend required",
  );
  const directory = "test-results/real-sign-in";
  await mkdir(directory, { recursive: true });
  // Real production route and adapters. Only explicit failure probes are intercepted.
  const observations = [];
  const anonymous = await browser.newContext();
  const signedOut = await anonymous.newPage();
  signedOut.on("pageerror", (e) => errors.push(e.message));
  await signedOut.goto(base);
  await signedOut
    .getByRole("heading", { name: "Sign in", exact: true })
    .waitFor();
  assert.equal(await signedOut.locator(".si-page").count(), 1);
  assert.equal(await signedOut.locator(".app-shell").count(), 0);
  assert.equal(await signedOut.getByText(appName, { exact: true }).count(), 1);
  assert.equal(
    await signedOut
      .getByRole("button", { name: /^(Account|Links|Sign out)$/ })
      .count(),
    0,
  );
  assert.equal(
    await signedOut.getByRole("link", { name: /admin/i }).count(),
    0,
  );
  assert.equal(await signedOut.locator("select").count(), 0);
  assert.equal(await signedOut.title(), `Sign in · ${appName}`);
  for (const theme of ["light", "dark"])
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
      [390, 420],
    ]) {
      await signedOut.emulateMedia({ colorScheme: theme });
      await signedOut.setViewportSize({ width, height });
      const geometry = await signedOut.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        background: getComputedStyle(document.querySelector(".si-page"))
          .backgroundColor,
        headingSize: getComputedStyle(document.querySelector("h1")).fontSize,
        controls: [
          ...document.querySelectorAll(".si-panel,input,.si-panel button"),
        ].map((e) => {
          const r = e.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            right: r.right,
            bottom: r.bottom,
            height: r.height,
          };
        }),
      }));
      assert.ok(geometry.width <= width, JSON.stringify(geometry));
      assert.equal(geometry.headingSize, "20px");
      for (const r of geometry.controls) {
        assert.ok(r.x >= 0 && r.right <= width);
        assert.ok(r.y >= 0 && r.bottom <= height);
      }
      for (const r of geometry.controls.slice(1)) assert.equal(r.height, 28);
      observations.push({ theme, width, height, ...geometry });
      await signedOut.screenshot({
        path: `${directory}/${appName}-${theme}-${width}x${height}.png`,
      });
    }
  assert.notEqual(observations[0].background, observations[3].background);
  const input = signedOut.getByLabel("Email", { exact: true });
  await input.fill("unknown-fixture@example.test");
  let release;
  const hold = new Promise((r) => (release = r));
  await signedOut.route(
    "**/api/auth/magic-link",
    async (route) => {
      await hold;
      await route.continue();
    },
    { times: 1 },
  );
  await signedOut
    .getByRole("button", { name: "Send sign-in link", exact: true })
    .click();
  await signedOut
    .getByRole("button", { name: "Sending link…", exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), "unknown-fixture@example.test");
  assert.ok(await input.isDisabled());
  release();
  await signedOut.getByText(/If this email belongs/).waitFor();
  assert.equal(await input.inputValue(), "unknown-fixture@example.test");
  await signedOut.screenshot({ path: `${directory}/${appName}-sent.png` });
  await signedOut.route(
    "**/api/auth/magic-link",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unavailable",
          message: "Email service unavailable. Try again.",
        }),
      }),
    { times: 1 },
  );
  await signedOut
    .getByRole("button", { name: "Send another link", exact: true })
    .click();
  await signedOut
    .getByText("Email service unavailable. Try again.", { exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), "unknown-fixture@example.test");
  await signedOut.screenshot({
    path: `${directory}/${appName}-email-error.png`,
  });
  await signedOut
    .getByRole("button", { name: "Try again", exact: true })
    .click();
  await signedOut.getByText(/If this email belongs/).waitFor();
  // Cancel while the real options response is held; no stale picker may start.
  await input.fill("");
  let releaseOptions;
  const optionsHold = new Promise((r) => (releaseOptions = r));
  await signedOut.route(
    "**/api/auth/passkeys/authenticate/options",
    async (route) => {
      await optionsHold;
      await route.continue();
    },
    { times: 1 },
  );
  await signedOut
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .click();
  await signedOut
    .getByRole("button", { name: "Waiting for passkey…", exact: true })
    .waitFor();
  await signedOut.getByRole("button", { name: "Cancel", exact: true }).click();
  await signedOut.getByText(/Passkey sign-in was cancelled/).waitFor();
  assert.ok(
    await signedOut
      .getByRole("button", { name: "Cancelling passkey…", exact: true })
      .isDisabled(),
  );
  releaseOptions();
  await signedOut
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .waitFor();
  await signedOut.getByText(/Passkey sign-in was cancelled/).waitFor();
  await signedOut.route(
    "**/api/auth/passkeys/authenticate/options",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unavailable",
          message: "Passkey service unavailable. Try again.",
        }),
      }),
    { times: 1 },
  );
  await signedOut
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .click();
  await signedOut
    .getByText("Passkey service unavailable. Try again.", { exact: true })
    .waitFor();
  assert.equal(await input.inputValue(), "");
  await signedOut.screenshot({
    path: `${directory}/${appName}-passkey-error.png`,
  });
  await anonymous.close();
  assert.deepEqual(errors, []);
  return observations;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    const base = process.env.SIGNIN_BASE;
    const appName = process.env.SIGNIN_APP_NAME || "Shortener";
    const observations = await verifySignedOut(browser, base, appName);
    const admin = await browser.newPage();
    await admin.goto(`${base}/_/`);
    await admin.getByLabel("Admin token", { exact: true }).waitFor();
    assert.equal(await admin.locator(".si-page").count(), 0);
    assert.equal(
      await admin
        .getByRole("button", { name: "Sign in with passkey", exact: true })
        .count(),
      0,
    );
    assert.equal(await admin.title(), `${appName} / Administration`);
    await admin.close();
    const receipt = {
      status: "PASS",
      separateAdminEntrypoint: true,
      actualRoute: base,
      appName,
      observations,
      explicitFailureProbes: ["email 503", "passkey options 503"],
      emailAcceptedByRealBackend: true,
    };
    await writeFile(
      `test-results/real-sign-in/${appName}-native-receipt.json`,
      JSON.stringify(receipt, null, 2),
    );
    console.log(JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
}
