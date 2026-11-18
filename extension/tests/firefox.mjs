import {
  measurePresentation,
  assertPresentation,
} from "./presentation-contract.mjs";
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
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertRequest,
  assertClipboard,
  nativeEnvironment,
  screenPoint,
} from "./firefox-contract.mjs";
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
const id = "shortener-companion-v2@shortener.invalid";
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
  if ((await driver.getContext()) !== "chrome")
    await driver.setContext("chrome");
};
const content = async () => {
  if ((await driver.getContext()) !== "content")
    await driver.setContext("content");
};
const snapshot = async (name) => {
  await writeFile(
    `${evidence}/${name}.png`,
    await driver.takeScreenshot(),
    "base64",
  );
  if (name.startsWith("native-popup"))
    execFileSync(
      "import",
      ["-window", "root", `${evidence}/desktop-${name}.png`],
      { timeout: 10000 },
    );
};
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
async function visibleChromeBox(selector) {
  return driver.executeScript(
    `
   for (const host of document.querySelectorAll(arguments[0])) {
     const panel=host.closest('panel');
     if (panel && panel.state!=='open') continue;
     let e=host;
     while(e.shadowRoot?.querySelector('button')) e=e.shadowRoot.querySelector('button');
     if (host.disabled || e.disabled) continue;
     const r=e.getBoundingClientRect();
     if(r.width>0 && r.height>0) return {x:r.x,y:r.y,width:r.width,height:r.height,screenX:window.mozInnerScreenX,screenY:window.mozInnerScreenY};
   }
   return null;
 `,
    selector,
  );
}
async function clickChromeControl(selector) {
  await native();
  let box;
  await wait(async () => {
    box = await visibleChromeBox(selector);
    return Boolean(box);
  }, "Native browser action control was not visible: " + selector);
  const point = screenPoint(box);
  execFileSync("xdotool", [
    "mousemove",
    "--sync",
    String(point.x),
    String(point.y),
    "click",
    "1",
  ]);
}
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
        .setEnvironment(nativeEnvironment(process.env))
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
  // Bind real X11 input to the owned Settings window, including on an Xvfb
  // server without a window manager before the first permission-request gesture.
  const pid = (await driver.getCapabilities()).get("moz:processID");
  assert.ok(Number.isInteger(pid) && pid > 0);
  const windowId = execFileSync(
    "xdotool",
    [
      "search",
      "--sync",
      "--onlyvisible",
      "--pid",
      String(pid),
      "--name",
      "Shortener settings",
    ],
    { encoding: "utf8", timeout: 5000 },
  )
    .trim()
    .split(/\s+/)[0];
  assert.match(windowId, /^\d+$/);
  const previousFocus = spawnSync("xdotool", ["getwindowfocus"], {
    encoding: "utf8",
    timeout: 2000,
  });
  receipt.x11FocusBefore =
    previousFocus.status === 0 ? previousFocus.stdout.trim() : "unfocused";
  receipt.x11TargetWindow = windowId;
  execFileSync("xdotool", ["windowfocus", "--sync", windowId], {
    timeout: 5000,
  });
  receipt.x11FocusAfter = execFileSync("xdotool", ["getwindowfocus"], {
    encoding: "utf8",
    timeout: 2000,
  }).trim();
  assert.equal(receipt.x11FocusAfter, windowId);
  receipt.stage = "save-permission-prompt";
  await driver.findElement(By.css('button[type="submit"]')).click();
  await native();
  // Accept the actual optional-host permission notification, if Firefox needs it.
  await wait(async () => {
    const box = await driver.executeScript(`
      const n=PopupNotifications.panel?.querySelector('popupnotification');
      if (!n || PopupNotifications.panel.state!=='open') return null;
      let button=n.button;
      while(button?.shadowRoot?.querySelector('button')) button=button.shadowRoot.querySelector('button');
      if(!button || button.disabled) return null;
      const r=button.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,screenX:window.mozInnerScreenX,screenY:window.mozInnerScreenY};
    `);
    if (box && box.width > 0 && box.height > 0 && !receipt.hostPromptClick) {
      const point = screenPoint(box);
      receipt.hostPromptClick = {
        ...point,
        source: "visible native inner button geometry",
      };
      execFileSync("xdotool", [
        "mousemove",
        "--sync",
        String(point.x),
        String(point.y),
        "click",
        "1",
      ]);
    }
    const text = await inSettings(
      'document.querySelector("#status").textContent',
    );
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
  receipt.manifestCommands = await driver.executeAsyncScript(
    "browser.commands.getAll().then(arguments[arguments.length-1]);",
  );
  await driver.switchTo().newWindow("tab");
  await driver.get(destination);
  assert.equal(await driver.getTitle(), title);
  await native();

  receipt.stage = "native-toolbar";
  execFileSync("xdotool", ["windowfocus", "--sync", windowId], {
    timeout: 5000,
  });
  receipt.x11ActionFocusAfter = execFileSync("xdotool", ["getwindowfocus"], {
    encoding: "utf8",
    timeout: 2000,
  }).trim();
  assert.equal(receipt.x11ActionFocusAfter, windowId);
  // Use the actual toolbar/Extensions-menu action rather than assuming the
  // default ctrl+shift+y binding is available on this OS/browser.
  const actionSelector =
    '.unified-extensions-item-action-button[data-extensionid="' + id + '"]';
  if (!(await visibleChromeBox(actionSelector)))
    await clickChromeControl("#unified-extensions-button");
  // Pin through Firefox's actual Extensions-menu UI in this disposable profile.
  // No private toolbar module/import or production profile customization.
  const onToolbar = () =>
    driver.executeScript(
      `const action=document.querySelector(arguments[0]);return !!action?.closest('#nav-bar');`,
      actionSelector,
    );
  if (!(await onToolbar())) {
    const menuSelector =
      ".unified-extensions-item:has(" +
      actionSelector +
      ") .unified-extensions-item-menu-button";
    await clickChromeControl(menuSelector);
    await clickChromeControl(".unified-extensions-context-menu-pin-to-toolbar");
    await wait(
      onToolbar,
      "Native Pin to Toolbar did not place the action in the navigation toolbar",
    );
    execFileSync("xdotool", ["key", "Escape"]);
  }
  assert.equal(
    requests.length,
    0,
    "Pinning the icon must not invoke the shortening action",
  );
  receipt.toolbarIcon = await driver.executeScript(
    `
    const action=document.querySelector(arguments[0]);
    const nodes=[action,...action.querySelectorAll('image,img,.toolbarbutton-icon')];
    const sources=nodes.flatMap(e=>{const s=getComputedStyle(e);return [e.getAttribute('src'),s.listStyleImage,s.getPropertyValue('--webextension-toolbar-image'),s.getPropertyValue('--webextension-toolbar-image-2x')];}).filter(Boolean);
    return {onToolbar:!!action.closest('#nav-bar'),packagedSources:sources.filter(s=>s.includes('icons/icon-'))};
  `,
    actionSelector,
  );
  assert.equal(receipt.toolbarIcon.onToolbar, true);
  assert.ok(
    receipt.toolbarIcon.packagedSources.length > 0,
    "Toolbar must reference actual packaged PNG, not the default puzzle icon",
  );
  pass("toolbar-icon");
  await clickChromeControl(actionSelector);
  receipt.activation = "real native toolbar/Extensions-menu action";
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
  receipt.presentation = await popup(
    `p=>(${measurePresentation.toString()})(p)`,
  );
  assertPresentation(receipt.presentation);
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
  receipt.markdownCapabilities = await popup(
    `p=>{const check=t=>{try{return typeof p.ClipboardItem?.supports==='function'?p.ClipboardItem.supports(t):null;}catch{return null;}};return {native:check('text/markdown'),customWeb:check('web text/markdown')};}`,
  );
  await clickPopup("#app a");
  await readRich("rich-native", expected);
  const writes = await popup("p=>p.__nativeWrites");
  receipt.nativeWrites = writes;
  const resolvedWrites = writes.filter((w) => w.resolved);
  assert.equal(resolvedWrites.length, 1);
  for (const w of writes)
    assert.equal(w.count, 1, "each native write uses one ClipboardItem");
  const types = resolvedWrites[0].types[0];
  assert.deepEqual(
    types.filter((t) => t !== "text/markdown"),
    ["text/html", "text/plain"],
  );
  const markdownText = String.raw`[Article &amp; Notes \<proof\>](${url})`;
  receipt.nativeMarkdown = {
    advertised: receipt.markdownCapabilities.native,
    customWebAdvertised: receipt.markdownCapabilities.customWeb,
    nativeReadback: false,
    status: "unsupported-or-rejected; optional native MIME skipped",
  };
  if (types.includes("text/markdown")) {
    try {
      const observed = clipboard("text/markdown");
      assert.equal(observed, markdownText);
      receipt.nativeMarkdown = {
        ...receipt.nativeMarkdown,
        nativeReadback: true,
        status: "native MIME readback verified",
      };
      await writeFile(`${evidence}/native-markdown.md`, observed);
    } catch {
      receipt.nativeMarkdown.status =
        "advertised/write resolved but native MIME not observed; not claimed supported";
    }
  }
  execFileSync("xclip", ["-selection", "clipboard"], {
    input: "markdown sentinel",
    stdio: ["pipe", "ignore", "ignore"],
    timeout: 2000,
  });
  await clickPopup('[data-copy="markdown"]');
  await wait(() => {
    try {
      return clipboard("text/plain") === markdownText;
    } catch {
      return false;
    }
  }, "Explicit Markdown action did not write exact native plaintext");
  await writeFile(`${evidence}/markdown-plain.txt`, clipboard("text/plain"));
  pass("markdown-clipboard");
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
  assert.equal((await popup("p=>p.__nativeWrites")).length, writes.length);
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
      receipt.chromeState = await driver.executeScript(`return {
        focused:document.hasFocus(),
        browsers:[...document.querySelectorAll('browser')].map(b=>({id:b.id,viewType:b.getAttribute('webextension-view-type'),src:b.getAttribute('src'),width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,panel:b.closest('panel')?.state})),
        panels:[...document.querySelectorAll('panel')].filter(p=>p.state!=='closed').map(p=>({id:p.id,state:p.state}))
      };`);
      try {
        receipt.extensionViews = await inSettings(
          "browser.extension.getViews().map(w=>({url:w.location.href,visible:w.document.visibilityState}))",
        );
      } catch (observationError) {
        receipt.observationError = observationError.message;
      }
    } catch {}
  }
  console.error(
    `FAIL Firefox acceptance at ${receipt.stage}: ${receipt.error}`,
  );
  throw error;
} finally {
  receipt.fixtureCreateCount = requests.length;
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
