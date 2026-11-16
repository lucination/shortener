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
  let releaseOptions;
  let optionsHeld;
  const heldOptions = new Promise((resolve) => (optionsHeld = resolve));
  await page.route(
    "**/api/auth/passkeys/register/options",
    async (route) => {
      const response = await route.fetch(); // Hold real challenge + binding cookie response.
      optionsHeld();
      await new Promise((resolve) => (releaseOptions = resolve));
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await page
    .getByLabel("New passkey name", { exact: true })
    .fill("Abandoned options");
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await heldOptions;
  await page.getByRole("button", { name: "Links", exact: true }).click();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const add = page.getByRole("button", { name: "Add passkey", exact: true });
  assert.equal(
    await add.isDisabled(),
    true,
    "abandoned options must settle before replacement",
  );
  releaseOptions();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].find(
        (node) => node.textContent === "Add passkey",
      )?.disabled,
  );
  assert.equal(
    requests.filter((r) => r.url.endsWith("register/verify")).length,
    0,
  );
  await page.evaluate(() => {
    window.__registrationRequests = 0;
    window.__registrationSettled = 0;
    const create = navigator.credentials.create.bind(navigator.credentials);
    navigator.credentials.create = async (options) => {
      window.__registrationRequests++;
      try {
        return await create(options);
      } finally {
        window.__registrationSettled++;
      }
    };
  });
  await client.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: false,
  });
  await page
    .getByLabel("New passkey name", { exact: true })
    .fill("Abandoned picker");
  await add.click();
  await page.waitForFunction(() => window.__registrationRequests === 1);
  await page.getByRole("button", { name: "Links", exact: true }).click();
  await page.waitForFunction(() => window.__registrationSettled === 1);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  assert.equal(
    requests.filter((r) => r.url.endsWith("register/verify")).length,
    0,
  );
  assert.deepEqual(
    (await (await context.request.get(`${base}/api/account/passkeys`)).json())
      .items,
    [],
  );
  await client.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: true,
  });
  const unicodeName = "🔑".repeat(80);
  await page.getByLabel("New passkey name", { exact: true }).focus();
  await page.keyboard.insertText(unicodeName);
  assert.equal(
    await page.getByLabel("New passkey name", { exact: true }).inputValue(),
    unicodeName,
  );
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
  const names = await (
    await context.request.get(`${base}/api/account/passkeys`)
  ).json();
  assert.deepEqual(
    names.items.map((key) => key.name),
    [unicodeName],
  );
  assert.deepEqual(Object.keys(names.items[0]).sort(), ["id", "name"]);
  await page.reload();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByLabel("Passkey name", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Passkey name", { exact: true }).inputValue(),
    unicodeName,
  );
  assert.equal(
    await page
      .getByLabel("Passkey name", { exact: true })
      .getAttribute("maxlength"),
    null,
  );
  await page.getByLabel("Passkey name", { exact: true }).fill("a🔑".repeat(40));
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByText("Passkey renamed.", { exact: true }).waitFor();
  assert.equal(
    (await (await context.request.get(`${base}/api/account/passkeys`)).json())
      .items[0].name,
    "a🔑".repeat(40),
  );
  await mkdir("test-results/passkey-names", { recursive: true });
  for (const width of [1280, 390, 320])
    for (const colorScheme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 850 });
      await page.emulateMedia({ colorScheme });
      await page.reload();
      await page.getByRole("button", { name: "Account", exact: true }).click();
      await page.getByLabel("Passkey name", { exact: true }).waitFor();
      assert.equal(
        await page.getByLabel("Passkey name", { exact: true }).inputValue(),
        "a🔑".repeat(40),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const boxes = await page
        .locator(
          '[data-testid="passkey-section"] input,[data-testid="passkey-section"] button',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().toJSON()),
        );
      assert(
        boxes.every((box) => box.x >= 0 && box.right <= width + 1),
        JSON.stringify(boxes),
      );
      await page.screenshot({
        path: `test-results/passkey-names/account-${width}-${colorScheme}.png`,
        fullPage: true,
      });
    }
  await page.setViewportSize({ width: 1280, height: 850 });
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
    namedEnrollmentAndRenameBeforeAuthentication: true,
    abandonedEnrollmentOptionsAndPicker: true,
    noAbandonedRegistrationPost: true,
    unicode80ScalarEnrollmentRenameAndReload: true,
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
