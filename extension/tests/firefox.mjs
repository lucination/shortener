/** Real Firefox prerequisite probe, not a substitute for native popup acceptance.
 * A startup/installation failure is fatal; no Chromium fallback or mocked APIs.
 */
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
const uuid = "11111111-2222-4333-8444-555555555555";
const id = "shortener-companion@shortener.invalid";
const evidence = process.env.EXTENSION_EVIDENCE;
if (!evidence || !process.env.FIREFOX_BIN || !process.env.GECKODRIVER)
  throw new Error(
    "Set EXTENSION_EVIDENCE, FIREFOX_BIN and GECKODRIVER explicitly",
  );
await mkdir(evidence, { recursive: true });
let driver;
const receipt = {
  scope:
    "real Firefox startup, built ZIP installation and settings smoke ONLY; native popup/clipboard acceptance remains separate",
  passed: false,
};
try {
  const options = new firefox.Options()
    .setBinary(process.env.FIREFOX_BIN)
    .addArguments("-remote-allow-system-access")
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ [id]: uuid }),
    );
  driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      new firefox.ServiceBuilder(process.env.GECKODRIVER).setStdio("inherit"),
    )
    .build();
  receipt.browserVersion = (await driver.getCapabilities()).get(
    "browserVersion",
  );
  const installed = await driver.installAddon(
    fileURLToPath(new URL("../dist/firefox.zip", import.meta.url)),
    true,
  );
  if (installed !== id) throw new Error("Unexpected installed add-on identity");
  await driver.get(`moz-extension://${uuid}/settings.html`);
  await driver.wait(until.elementLocated(By.css("#settings-form")), 10000);
  if (
    (await driver.findElement(By.css("h1")).getText()) !== "Shortener settings"
  )
    throw new Error("Real settings page mismatch");
  await writeFile(
    `${evidence}/firefox-settings.png`,
    await driver.takeScreenshot(),
    "base64",
  );
  receipt.passed = true;
  console.log(
    "PASS: Firefox installed actual ZIP and rendered settings. Native toolbar/clipboard NOT accepted by this probe.",
  );
} catch (error) {
  receipt.error = error.message;
  console.error(
    "BLOCKED: real Firefox prerequisite failed. No native popup or clipboard result can be claimed.",
  );
  throw error;
} finally {
  if (driver) await driver.quit();
  await writeFile(
    `${evidence}/firefox-runtime.json`,
    JSON.stringify(receipt, null, 2) + "\n",
  );
}
