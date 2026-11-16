import { verifySignedOut } from "./verify-user-sign-in.mjs";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.SIGNIN_BASE;
assert.ok(
  base && new URL(base).hostname === "localhost",
  "task-local backend required",
);
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const appName = process.env.SIGNIN_APP_NAME || "Shortener";
const directory = "test-results/real-sign-in";
await mkdir(directory, { recursive: true });
const errors = [],
  requests = [];
try {
  const observations = await verifySignedOut(browser, base, appName, errors);
  const context = await browser.newContext();
  await context.addCookies([
    { name: "short_session", value: process.env.SIGNIN_SESSION, url: base },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/auth/passkeys/"))
      requests.push({ url: new URL(r.url()).pathname, body: r.postDataJSON() });
  });
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  let assertion;
  await page.route(
    "**/api/auth/passkeys/authenticate/verify",
    async (route) => {
      await page
        .getByRole("button", { name: "Signing in…", exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Cancel", exact: true }).count(),
        0,
      );
      assertion = route.request().postDataJSON();
      const stranger = await browser.newContext();
      try {
        const denied = await stranger.request.post(route.request().url(), {
          headers: { Origin: base },
          data: assertion,
        });
        assert.equal(
          denied.status(),
          401,
          "assertion is bound to the initiating browser cookie",
        );
      } finally {
        await stranger.close();
      }
      await route.continue();
    },
  );
  await page.goto(base);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await page
    .getByText("Passkey added to your account.", { exact: true })
    .waitFor({ timeout: 10000 })
    .catch(async (error) => {
      console.error(
        "CEREMONY_DIAGNOSTIC",
        await page.locator("body").innerText(),
        JSON.stringify(errors),
      );
      throw error;
    });
  const { credentials } = await client.send("WebAuthn.getCredentials", {
    authenticatorId,
  });
  assert.equal(credentials.length, 1);
  assert.equal(credentials[0].isResidentCredential, true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const email = page.getByLabel("Email", { exact: true });
  await email.waitFor();
  assert.equal(await email.inputValue(), "");
  await page.evaluate(() => {
    const get = navigator.credentials.get.bind(navigator.credentials);
    window.__passkeyRequests = 0;
    navigator.credentials.get = (options) => {
      window.__passkeyRequests++;
      return get(options);
    };
  });
  await client.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: false,
  });
  await page
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .click();
  await page.waitForFunction(() => window.__passkeyRequests === 1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByText(/Passkey sign-in was cancelled/).waitFor();
  assert.equal(
    requests.filter((r) => r.url.endsWith("authenticate/verify")).length,
    0,
  );
  await client.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: true,
  });
  await page
    .getByRole("button", { name: "Sign in with passkey", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  const user = await (await context.request.get(`${base}/api/me`)).json();
  assert.equal(user.email, "virtual@example.test");
  const replay = await context.request.post(
    `${base}/api/auth/passkeys/authenticate/verify`,
    { headers: { Origin: base }, data: assertion },
  );
  assert.equal(replay.status(), 401);

  const auth = requests.find((r) => r.url.endsWith("authenticate/options"));
  assert.deepEqual(auth.body, {});
  assert.deepEqual(errors, []);
  await mkdir("test-results/passkey-sign-in", { recursive: true });
  await page.screenshot({
    path: "test-results/passkey-sign-in/authenticated.png",
  });
  const receipt = {
    status: "PASS",
    appName,
    actualRoute: base,
    productionComponent: ".si-page",
    observations,
    emailAcceptedByRealBackend: true,
    explicitFailureProbes: ["email 503", "passkey options 503"],
    cancellationWithHeldOptions: true,
    authenticator: "Chromium CDP CTAP2 resident UV",
    emptyEmail: true,
    actualPickerCancelled: true,
    verificationHasNoMisleadingCancel: true,
    crossBrowserRejected: true,
    replayRejected: true,
    credentialCount: credentials.length,
    resident: credentials[0].isResidentCredential,
    userId: user.id,
    apiPaths: requests.map((r) => r.url),
    pageErrors: errors,
  };
  await writeFile(
    "test-results/passkey-sign-in/receipt.json",
    JSON.stringify(receipt, null, 2),
  );
  await writeFile(
    `${directory}/${appName}-receipt.json`,
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
} finally {
  await browser.close();
}
