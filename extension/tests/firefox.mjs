/** Headed native Firefox acceptance. No live account, mocked browser API or AMO.
 * Browser chrome opens the real toolbar popup. BiDi observes that actual popup
 * through the installed extension's own getViews(), without selecting another
 * tab. X11 clicks and xclip readback exercise the OS clipboard, not a JS store.
 */
import assert from "node:assert/strict";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertRequest, assertClipboard } from "./firefox-contract.mjs";
import { nativeChecks } from "../scripts/native-policy.mjs";
const evidence = process.env.EXTENSION_EVIDENCE;
if (!evidence || !process.env.FIREFOX_BIN || !process.env.GECKODRIVER)
  throw new Error(
    "Explicit EXTENSION_EVIDENCE, FIREFOX_BIN and GECKODRIVER required",
  );
await mkdir(evidence, { recursive: true });
const zip = resolve("dist/firefox.zip");
const digest = async () =>
  createHash("sha256")
    .update(await readFile(zip))
    .digest("hex");
const receipt = {
  schema: 1,
  artifactSha256: await digest(),
  sourceSha:
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  runId: process.env.GITHUB_RUN_ID ?? "local",
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
  checks: {},
  stage: "startup",
};
const pass = (name) => {
  receipt.checks[name] = "passed";
  console.log(`PASS ${name}`);
};
const id = "shortener-companion@shortener.invalid";
const uuid = "11111111-2222-4333-8444-555555555555";
const title = "Article & Notes <proof>";
const token = "short_at_" + "a".repeat(64); // test fixture only; cannot authenticate to a live service
const requests = [];
let service;
const apiServer = createServer(async (req, res) => {
  if (req.url === "/seed-cookie") {
    res.setHeader("Set-Cookie", "short_session=fixture-cookie; Path=/");
    res.end("<title>Service, not active article</title>");
    return;
  }
  if (req.url === "/api/links") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) {
        res.writeHead(413).end();
        return;
      }
    }
    try {
      requests.push({
        method: req.method,
        path: req.url,
        body: JSON.parse(body),
        authorization: req.headers.authorization,
        cookie: req.headers.cookie,
      });
    } catch {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(201, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        addresses: [
          {
            domain_id: 1,
            domain: new URL(service).host,
            short_code: "abc123",
          },
        ],
      }),
    );
    return;
  }
  res.writeHead(404).end();
});
const pageServer = createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    '<title>Article &amp; Notes &lt;proof&gt;</title><p id="article">Distinct active tab fixture</p>',
  );
});
let driver, bidi, settingsHandle;
const native = async () => {
  await driver.switchTo().defaultContent();
  await driver.setContext("chrome");
};
const content = async () => {
  await driver.setContext("content");
};
const snapshot = async (name) =>
  writeFile(`${evidence}/${name}.png`, await driver.takeScreenshot(), "base64");
const wait = async (fn, message) => driver.wait(fn, 15000, message, 200);
// Evaluate in background Settings without selecting it: selecting it would close
// the native popup and change activeTab. This only reads/operates the real view.
async function inSettings(expression) {
  const response = await bidi.send({
    method: "script.evaluate",
    params: {
      expression: `JSON.stringify(${expression})`,
      target: { context: settingsHandle },
      awaitPromise: true,
      resultOwnership: "none",
    },
  });
  const result = response.result;
  if (result?.type !== "success")
    throw new Error(
      "BiDi Settings evaluation failed: " +
        JSON.stringify(result?.exceptionDetails ?? response),
    );
  return JSON.parse(result.result.value);
}
const popup = (code) =>
  inSettings(
    `(()=>{const p=browser.extension.getViews({type:'popup'})[0];if(!p)throw Error('Native popup view is absent');return (${code})(p);})()`,
  );
async function clickPopup(selector) {
  const point = await popup(
    `p=>{const e=p.document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing popup control');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};}`,
  );
  await native();
  const box = await driver.executeScript(
    `const b=[...document.querySelectorAll('browser[webextension-view-type="popup"]')].find(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0 && b.closest('panel')?.state==='open');if(!b)throw Error('Native browser popup is absent');const r=b.getBoundingClientRect();return {x:window.mozInnerScreenX+r.x,y:window.mozInnerScreenY+r.y};`,
  );
  execFileSync("xdotool", [
    "mousemove",
    "--sync",
    String(Math.round(box.x + point.x)),
    String(Math.round(box.y + point.y)),
    "click",
    "1",
  ]);
}
function clipboard(type) {
  return execFileSync(
    "xclip",
    ["-selection", "clipboard", "-o", "-target", type],
    { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "pipe"] },
  );
}
async function readRich(name, expected) {
  let plain, html;
  await wait(() => {
    try {
      plain = clipboard("text/plain");
      html = clipboard("text/html");
      assertClipboard(plain, html, expected);
      return true;
    } catch {
      return false;
    }
  }, `Native clipboard ${name} did not match plain/HTML contract`);
  await writeFile(`${evidence}/${name}.txt`, plain);
  await writeFile(`${evidence}/${name}.html`, html);
}
try {
  apiServer.listen(0, "127.0.0.1");
  await once(apiServer, "listening");
  service = `http://127.0.0.1:${apiServer.address().port}`;
  pageServer.listen(0, "127.0.0.1");
  await once(pageServer, "listening");
  const destination = `http://localhost:${pageServer.address().port}/article`;
  assert.notEqual(new URL(destination).origin, new URL(service).origin);
  const options = new firefox.Options()
    .setBinary(process.env.FIREFOX_BIN)
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ [id]: uuid }),
    )
    .setPreference("layout.css.devPixelsPerPx", "1.0");
  options.set("webSocketUrl", true);
  driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      new firefox.ServiceBuilder(process.env.GECKODRIVER)
        .addArguments("--allow-system-access")
        .setStdio("inherit"),
    )
    .build();
  await driver.manage().setTimeouts({ script: 15000, pageLoad: 20000 });
  receipt.browserVersion = (await driver.getCapabilities()).get(
    "browserVersion",
  );
  assert.equal(receipt.browserVersion, "160.0.1");
  bidi = await driver.getBidi();
  receipt.stage = "install-real-zip";
  assert.equal(await driver.installAddon(zip, true), id);
  await driver.get(service + "/seed-cookie");
  assert.equal(
    (await driver.manage().getCookie("short_session")).value,
    "fixture-cookie",
  );
  await driver.get(`moz-extension://${uuid}/settings.html`);
  settingsHandle = await driver.getWindowHandle();
  await driver.wait(until.elementLocated(By.css("#settings-form")), 15000);
  await driver.findElement(By.id("service")).sendKeys(service);
  await driver.findElement(By.id("token")).sendKeys(token);
  receipt.stage = "save-permission-prompt";
  await driver.findElement(By.css('button[type="submit"]')).click();
  await native();
  // Accept the actual optional-host permission notification, if Firefox needs it.
  await wait(async () => {
    const button = await driver.executeScript(
      "const n=PopupNotifications.panel?.querySelector('popupnotification');return n && PopupNotifications.panel.state==='open' ? n.button : null;",
    );
    if (button && (await button.isEnabled())) {
      await button.click();
      return true;
    }
    await content();
    const text = await driver.findElement(By.id("status")).getText();
    await native();
    return text.includes("Saved.");
  }, "Save did not grant service host access");
  await content();
  await wait(
    async () =>
      (await driver.findElement(By.id("status")).getText()).includes("Saved."),
    "Settings were not saved",
  );
  pass("settings-save");
  const pattern = `${service.replace(/:\d+$/, "")}/*`;
  assert.equal(
    await driver.executeAsyncScript(
      "browser.permissions.contains({origins:[arguments[0]]}).then(arguments[arguments.length-1]);",
      pattern,
    ),
    true,
  );
  pass("host-grant");
  await snapshot("settings-saved");
  await driver.switchTo().newWindow("tab");
  await driver.get(destination);
  assert.equal(await driver.getTitle(), title);
  await native();
  await driver.executeScript(
    `const {CustomizableUI}=ChromeUtils.importESModule('resource:///modules/CustomizableUI.sys.mjs');CustomizableUI.addWidgetToArea('shortener-companion_shortener_invalid-browser-action',CustomizableUI.AREA_NAVBAR);`,
  );
  receipt.stage = "native-toolbar";
  // The real action shortcut supplies the active-tab grant and native popup.
  execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+shift+y"]);
  await wait(
    async () =>
      driver.executeScript(
        `const b=[...document.querySelectorAll('browser[webextension-view-type="popup"]')].find(b=>b.getBoundingClientRect().width>0 && b.getBoundingClientRect().height>0 && b.closest('panel')?.state==='open');return !!b && b.getBoundingClientRect().width>0;`,
      ),
    "Native toolbar popup did not open",
  );
  await wait(async () => {
    try {
      return (await popup("p=>p.location.pathname")) === "/popup.html";
    } catch {
      return false;
    }
  }, "Native popup extension view absent");
  pass("native-toolbar");
  await wait(
    () => requests.length === 1,
    "Toolbar popup did not create exactly one fixture request",
  );
  assertRequest(requests[0], { destination, title, token });
  receipt.fixture = {
    destination,
    title,
    bearerOnly: true,
    cookieAbsent: requests[0].cookie === undefined,
  };
  pass("active-tab-request");
  pass("bearer-without-cookie");
  const url = service + "/abc123";
  const expected = { title, url };
  await wait(
    async () =>
      (await popup(
        `p=>p.document.querySelector('#app a')?.getAttribute('href')`,
      )) === url,
    "Popup did not display fixture short URL",
  );
  await snapshot("native-popup");
  receipt.stage = "native-plain-clipboard";
  execFileSync("xclip", ["-selection", "clipboard"], {
    input: "plain sentinel",
    timeout: 2000,
    stdio: ["pipe", "ignore", "ignore"],
  });
  await clickPopup("#app button");
  await wait(() => {
    try {
      return clipboard("text/plain") === url;
    } catch {
      return false;
    }
  }, "Copy URL did not reach the native clipboard");
  await writeFile(`${evidence}/plain.txt`, clipboard("text/plain"));
  pass("plain-clipboard");
  // Transparent instrumentation delegates to the actual native implementation;
  // an API error/fallback here is NOT accepted as native ClipboardItem support.
  await popup(
    `p=>{const native=p.navigator.clipboard.write.bind(p.navigator.clipboard);p.__nativeWrites=[];p.navigator.clipboard.write=async items=>{const observation={count:items.length,types:items.map(i=>[...i.types].sort()),resolved:false};p.__nativeWrites.push(observation);const value=await native(items);observation.resolved=true;return value;};return true;}`,
  );
  await clickPopup("#app a");
  await readRich("rich-native", expected);
  const writes = await popup("p=>p.__nativeWrites");
  receipt.nativeWrites = writes;
  assert.equal(writes.length, 1);
  assert.equal(writes[0].count, 1);
  assert.deepEqual(writes[0].types, [["text/html", "text/plain"]]);
  assert.equal(writes[0].resolved, true);
  pass("rich-native-clipboard");
  receipt.stage = "native-copy-event-fallback";
  receipt.fallbackFeatureControl = "ClipboardItem unavailable (forced)";
  // Force only feature detection unavailable; production copy-event implementation
  // and native X11 clipboard remain unchanged. Never inject clipboard data here.
  await popup(
    `p=>{Object.defineProperty(p,'ClipboardItem',{configurable:true,value:undefined});p.__fallbackObserved=false;p.document.addEventListener('copy',()=>{p.__fallbackObserved=true;},{once:true});return typeof p.ClipboardItem;}`,
  );
  // Distinct sentinel ensures a previously correct clipboard cannot falsely pass.
  execFileSync("xclip", ["-selection", "clipboard"], {
    input: "fallback sentinel",
    timeout: 2000,
    stdio: ["pipe", "ignore", "ignore"],
  });
  await clickPopup("#app a");
  await readRich("rich-fallback", expected);
  assert.equal(await popup("p=>p.__fallbackObserved"), true);
  assert.equal((await popup("p=>p.__nativeWrites")).length, 1);
  pass("rich-fallback-clipboard");
  assert.equal(
    requests.length,
    1,
    "Clipboard retries must not create another link",
  );
  await native();
  await snapshot("native-popup-after-fallback");
  execFileSync("xdotool", ["key", "Escape"]);
  await content();
  await driver.switchTo().window(settingsHandle);
  receipt.stage = "forget";
  await driver.findElement(By.id("forget")).click();
  await wait(
    async () =>
      (await driver.findElement(By.id("status")).getText()).includes(
        "Settings forgotten.",
      ),
    "Forget did not complete",
  );
  assert.equal(
    await driver.executeAsyncScript(
      "browser.permissions.contains({origins:[arguments[0]]}).then(arguments[arguments.length-1]);",
      pattern,
    ),
    false,
  );
  assert.equal(
    await driver.executeAsyncScript(
      'browser.storage.local.get("settings").then(x=>arguments[arguments.length-1](x.settings===undefined));',
    ),
    true,
  );
  assert.equal(
    await driver.findElement(By.id("token")).getAttribute("value"),
    "",
  );
  pass("forget-settings");
  await snapshot("settings-forgotten");
  assert.equal(
    await digest(),
    receipt.artifactSha256,
    "Installed artifact changed during acceptance",
  );
  assert.deepEqual(
    Object.keys(receipt.checks).sort(),
    [...nativeChecks].sort(),
  );
  receipt.stage = "complete";
  console.log(
    "Native Firefox acceptance completed against actual packaged ZIP and X11 clipboard.",
  );
} catch (error) {
  receipt.error = String(error.message).slice(0, 2000);
  if (driver) {
    try {
      await native();
      await snapshot("failure");
    } catch {}
  }
  console.error(
    `FAIL Firefox acceptance at ${receipt.stage}: ${receipt.error}`,
  );
  throw error;
} finally {
  if (driver) {
    try {
      await driver.quit();
    } catch (error) {
      receipt.cleanupError = error.message;
      process.exitCode = 1;
    }
  }
  for (const server of [apiServer, pageServer]) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await writeFile(
    `${evidence}/firefox-runtime.json`,
    JSON.stringify(receipt, null, 2) + "\n",
  );
}
