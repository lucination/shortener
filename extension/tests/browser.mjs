import {
  measurePresentation,
  assertPresentation,
} from "./presentation-contract.mjs";
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
const extension = fileURLToPath(new URL("../dist/chrome", import.meta.url));
const id = [
  ...createHash("sha256").update(extension).digest("hex").slice(0, 32),
]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");
const profile = await mkdtemp(`${tmpdir()}/shortener-browser-`);
const artifacts =
  process.env.EXTENSION_EVIDENCE ||
  fileURLToPath(new URL("../artifacts", import.meta.url));
await mkdir(artifacts, { recursive: true });
const requests = [];
const visualMeasurements = [];
const longCode = "abc123" + "a".repeat(120);

let release;
let held = new Promise((resolve) => (release = resolve));
let status = 201;
const server = createServer(async (req, res) => {
  if (req.url === "/page") {
    res.end(
      "<title>Article &amp; Notes &lt;proof&gt;</title><p>Current page</p>",
    );
    return;
  }
  if (req.url === "/api/links") {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      body: JSON.parse(body),
      authorization: req.headers.authorization,
      cookie: req.headers.cookie,
    });
    const currentStatus = status;
    const domainHost = `127.0.0.1:${server.address().port}`;
    await held;
    res.writeHead(currentStatus, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        addresses: [
          {
            domain_id: 1,
            domain: domainHost,
            short_code: longCode,
          },
        ],
      }),
    );
    return;
  }
  res.writeHead(404).end();
}).listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
let wire;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    viewport: { width: 900, height: 700 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=0",
    ],
  });
  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${id}/settings.html`);
  await settings.evaluate(() =>
    chrome.storage.local.set({
      settings: {
        service: "https://old.example",
        token: "legacy-session-credential",
      },
    }),
  );
  await settings.reload();
  const captureSettings = async (label) => {
    for (const theme of ["light", "dark"])
      for (const width of [320, 900]) {
        await settings.emulateMedia({ colorScheme: theme });
        await settings.setViewportSize({ width, height: 700 });
        const metrics = await settings.evaluate(measurePresentation);
        assertPresentation(metrics);
        visualMeasurements.push({
          view: "actual extension settings",
          label,
          theme,
          width,
          metrics,
        });
        await settings.screenshot({
          path: `${artifacts}/settings-${label}-${theme}-${width}.png`,
          fullPage: true,
        });
      }
    await settings.emulateMedia({ colorScheme: "light" });
    await settings.setViewportSize({ width: 900, height: 700 });
  };
  await expect(settings.locator("#service")).toHaveValue("https://old.example");
  await expect(settings.locator("#token")).toHaveValue("");
  await expect(settings.locator("#status")).toContainText(
    "Account → Access tokens",
  );
  await settings.locator("#forget").click();
  await expect(settings.locator("#status")).toContainText(
    "Settings forgotten.",
  );
  assertEqual(
    await settings.evaluate(
      async () => (await chrome.storage.local.get("settings")).settings,
    ),
    undefined,
  );
  await captureSettings("migration");
  console.log(
    "PASS: legacy service retained for migration, credential never prefilled, Forget succeeds",
  );
  await settings.locator("#service").fill("https://short.example/api");
  await settings
    .locator("#token")
    .fill(
      "short_at_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.locator("#status")).toContainText("origin", {
    timeout: 8000,
  });
  await captureSettings("validation-error");
  console.log("PASS: actual extension settings rejects a service path");
  await settings.locator("#service").fill(origin);
  await settings
    .locator("#token")
    .fill(
      "short_at_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  try {
    await expect(settings.locator("#status")).toContainText("Saved.", {
      timeout: 1500,
    });
  } catch {
    execFileSync("xdotool", ["key", "Tab", "Return"]);
  }
  await expect(settings.locator("#status")).toContainText("Saved.", {
    timeout: 8000,
  });
  assertEqual(
    await settings.evaluate(
      async () => (await chrome.storage.local.get("settings")).settings.service,
    ),
    origin,
  );
  await captureSettings("saved");
  const target = await context.newPage();
  // The service grant is 127.0.0.1 only. Reading localhost therefore needs the
  // real action's activeTab grant, not incidental access to the service host.
  assertEqual(
    await settings.evaluate(() =>
      chrome.permissions.contains({ origins: ["http://localhost/*"] }),
    ),
    false,
  );
  const pageURL = `http://localhost:${server.address().port}/page`;
  await target.goto(pageURL);
  const [port, endpoint] = (
    await readFile(`${profile}/DevToolsActivePort`, "utf8")
  )
    .trim()
    .split("\n");
  wire = await connect(`ws://127.0.0.1:${port}${endpoint}`);
  const openPopup = async () => {
    await target.bringToFront();
    await expect
      .poll(
        async () =>
          (await wire.send("Target.getTargets")).targetInfos.filter(
            (t) => t.url === `chrome-extension://${id}/popup.html`,
          ).length,
      )
      .toBe(0);
    const windowId = execFileSync(
      "xdotool",
      ["search", "--onlyvisible", "--class", "chromium"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")[0];
    execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
    execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+shift+y"]);
    let popupId;
    await expect
      .poll(async () => {
        popupId = (await wire.send("Target.getTargets")).targetInfos.find(
          (t) => t.url === `chrome-extension://${id}/popup.html`,
        )?.targetId;
        return !!popupId;
      })
      .toBe(true);
    const { sessionId } = await wire.send("Target.attachToTarget", {
      targetId: popupId,
      flatten: true,
    });
    const evaluate = async (expression) => {
      const result = await wire.send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      );
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const click = async (selector) => {
      const rect = await evaluate(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      );
      await wire.send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", button: "left", clickCount: 1, ...rect },
        sessionId,
      );
      await wire.send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", button: "left", clickCount: 1, ...rect },
        sessionId,
      );
    };
    return { evaluate, click, sessionId };
  };
  const capturePopup = async (label, view) => {
    for (const theme of ["light", "dark"])
      for (const width of [320, 360]) {
        await wire.send(
          "Emulation.setEmulatedMedia",
          { features: [{ name: "prefers-color-scheme", value: theme }] },
          view.sessionId,
        );
        // Native popup targets reject device-metrics overrides. Resize the actual
        // popup's preferred body width and wait for its real viewport to follow.
        await view.evaluate(`document.body.style.width='${width}px'`);
        await expect.poll(() => view.evaluate("innerWidth")).toBe(width);
        await view.evaluate(
          "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        );
        const metrics = await view.evaluate(
          `(${measurePresentation.toString()})(window)`,
        );
        assertPresentation(metrics);
        visualMeasurements.push({
          view: "actual native popup target",
          label,
          theme,
          width,
          metrics,
        });
        const height = await view.evaluate(
          "Math.ceil(document.body.getBoundingClientRect().height)",
        );
        const shot = await wire.send(
          "Page.captureScreenshot",
          {
            format: "png",
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 },
          },
          view.sessionId,
        );
        await writeFile(
          `${artifacts}/popup-${label}-${theme}-${width}.png`,
          Buffer.from(shot.data, "base64"),
        );
      }
    await view.evaluate("document.body.style.width=''");
    await wire.send(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-color-scheme", value: "light" }] },
      view.sessionId,
    );
  };
  let { evaluate, click, sessionId } = await openPopup();
  await expect
    .poll(() => evaluate('document.querySelector("#app").textContent'))
    .toContain("Shortening…");
  await expect.poll(() => requests.length).toBe(1);
  await capturePopup("loading", { evaluate, sessionId });
  assertEqual(requests[0].body.destination, pageURL);
  assertEqual(requests[0].body.title, "Article & Notes <proof>");
  assertEqual(
    requests[0].authorization,
    "Bearer short_at_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  assertEqual(requests[0].cookie, undefined);
  release();
  await expect
    .poll(() => evaluate('document.querySelector("#app").textContent'))
    .toContain("URL copied.");
  const short = `${origin}/${longCode}`;
  assertEqual(
    execFileSync(
      "xclip",
      ["-selection", "clipboard", "-t", "text/plain", "-o"],
      {
        encoding: "utf8",
      },
    ),
    short,
  );
  assertEqual(await evaluate('document.querySelector(".title").href'), short);
  const markdownCapabilities = await evaluate(
    `(()=>{const check=t=>{try{return typeof ClipboardItem.supports==='function'?ClipboardItem.supports(t):null;}catch{return null;}};return {native:check('text/markdown'),customWeb:check('web text/markdown')};})()`,
  );
  await evaluate(
    `(()=>{const native=navigator.clipboard.write.bind(navigator.clipboard);window.nativeWrites=[];navigator.clipboard.write=async items=>{const record={count:items.length,types:items.map(i=>[...i.types].sort()),resolved:false};window.nativeWrites.push(record);const result=await native(items);record.resolved=true;return result;};})()`,
  );
  await click(".title");
  await expect
    .poll(() => evaluate('document.querySelector("#feedback")?.textContent'))
    .toContain("Formatted link copied.");
  const html = execFileSync(
    "xclip",
    ["-selection", "clipboard", "-t", "text/html", "-o"],
    { encoding: "utf8" },
  );
  const text = execFileSync(
    "xclip",
    ["-selection", "clipboard", "-t", "text/plain", "-o"],
    {
      encoding: "utf8",
    },
  );
  if (
    !html.includes(`<a href="${short}">Article &amp; Notes &lt;proof&gt;</a>`)
  )
    throw new Error(`Unexpected clipboard HTML: ${html}`);
  assertEqual(text, short);
  const nativeWrites = await evaluate("window.nativeWrites");
  const resolvedWrites = nativeWrites.filter((w) => w.resolved);
  assertEqual(resolvedWrites.length, 1);
  for (const w of nativeWrites) assertEqual(w.count, 1);
  const markdownText = String.raw`[Article & Notes \<proof\>](${short})`;
  const mimeReceipt = {
    capabilities: markdownCapabilities,
    nativeWrites,
    nativeMarkdown: {
      nativeReadback: false,
      status: "unsupported-or-rejected; optional native MIME skipped",
    },
  };
  if (resolvedWrites[0].types[0].includes("text/markdown")) {
    try {
      const observed = execFileSync(
        "xclip",
        ["-selection", "clipboard", "-t", "text/markdown", "-o"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      assertEqual(observed, markdownText);
      mimeReceipt.nativeMarkdown = {
        nativeReadback: true,
        status: "native MIME readback verified",
      };
      await writeFile(`${artifacts}/native-markdown.md`, observed);
    } catch {
      mimeReceipt.nativeMarkdown.status =
        "advertised/write resolved but native MIME not observed; not claimed supported";
    }
  }
  await click('[data-copy="markdown"]');
  await expect
    .poll(() => evaluate('document.querySelector("#feedback").textContent'))
    .toBe("Markdown copied.");
  const markdownPlain = execFileSync(
    "xclip",
    ["-selection", "clipboard", "-t", "text/plain", "-o"],
    { encoding: "utf8" },
  );
  assertEqual(markdownPlain, markdownText);
  await writeFile(`${artifacts}/markdown-plain.txt`, markdownPlain);
  await writeFile(
    `${artifacts}/markdown-support.json`,
    JSON.stringify(mimeReceipt, null, 2),
  );
  await click("#app button");
  await expect
    .poll(() => evaluate('document.querySelector("#feedback").textContent'))
    .toBe("URL copied.");
  assertEqual(
    execFileSync(
      "xclip",
      ["-selection", "clipboard", "-t", "text/plain", "-o"],
      { encoding: "utf8" },
    ),
    short,
  );
  assertEqual(requests.length, 1);
  console.log("READBACK rich:", JSON.stringify({ html, text }));
  assertEqual(requests.length, 1);
  await capturePopup("ready-long-url", { evaluate, sessionId });
  console.log(
    "PASS: real toolbar invocation reads activeTab; held POST/loading; user bearer; plain URL clipboard; title hyperlink copies real HTML + text without navigation or another POST",
  );

  held = new Promise((resolve) => (release = resolve));
  ({ evaluate, click, sessionId } = await openPopup());
  await expect.poll(() => requests.length).toBe(2);
  await evaluate(
    `(() => { const original = navigator.clipboard.writeText.bind(navigator.clipboard); let first = true; navigator.clipboard.writeText = text => { if (first) { first = false; return Promise.reject(new Error('forced automatic clipboard denial')); } return original(text); }; })()`,
  );
  release();
  await expect
    .poll(() => evaluate('document.querySelector("#app").textContent'))
    .toContain("Automatic URL copy did not complete");
  await capturePopup("copy-denial", { evaluate, sessionId });
  await click("#app button");
  await expect
    .poll(() => evaluate('document.querySelector("#feedback").textContent'))
    .toContain("URL copied.");
  assertEqual(
    execFileSync(
      "xclip",
      ["-selection", "clipboard", "-t", "text/plain", "-o"],
      {
        encoding: "utf8",
      },
    ),
    short,
  );
  assertEqual(requests.length, 2);
  // Hold the rich write until a competing URL/title click has been delivered.
  // Rejecting it must finish the real copy-event fallback before either action
  // can write again: a feedback-only attempt counter cannot protect clipboard IO.
  await evaluate(`(() => {
    window.originalRichWrite = navigator.clipboard.write.bind(navigator.clipboard);
    window.richAttempts = 0;
    navigator.clipboard.write = () => {
      window.richAttempts++;
      return new Promise((_, reject) => { window.rejectRichWrite = reject; });
    };
  })()`);
  await click(".title");
  assertEqual(
    await evaluate('document.querySelector("#app button").disabled'),
    true,
  );
  await click("#app button");
  await evaluate(`(() => {
    document.querySelector('[data-copy="markdown"]').dispatchEvent(new MouseEvent('click', {cancelable:true}));
    document.querySelector('#app button').dispatchEvent(new MouseEvent('click', {cancelable:true}));
    const event = new MouseEvent('click', {cancelable:true});
    document.querySelector('.title').dispatchEvent(event);
    if (!event.defaultPrevented) throw new Error('title navigated');
    window.rejectRichWrite(new Error('held rich write denial'));
  })()`);
  await expect
    .poll(() => evaluate('document.querySelector("#feedback").textContent'))
    .toBe("Formatted link copied.");
  assertEqual(await evaluate("window.richAttempts"), 1);
  assertEqual(
    execFileSync(
      "xclip",
      ["-selection", "clipboard", "-t", "text/plain", "-o"],
      {
        encoding: "utf8",
      },
    ),
    short,
  );
  const raceHtml = execFileSync(
    "xclip",
    ["-selection", "clipboard", "-t", "text/html", "-o"],
    { encoding: "utf8" },
  );
  if (
    !raceHtml.includes(
      `<a href="${short}">Article &amp; Notes &lt;proof&gt;</a>`,
    )
  )
    throw new Error("Held rich fallback did not write real HTML");
  console.log(
    "READBACK held-rejection fallback:",
    JSON.stringify({ html: raceHtml, text: short }),
  );
  assertEqual(await evaluate('document.querySelector(".title").href'), short);
  assertEqual(
    await evaluate('document.querySelector("#app button").disabled'),
    false,
  );
  await click("#app button");
  await expect
    .poll(() => evaluate('document.querySelector("#feedback").textContent'))
    .toBe("URL copied.");
  assertEqual(
    execFileSync(
      "xclip",
      ["-selection", "clipboard", "-t", "text/plain", "-o"],
      {
        encoding: "utf8",
      },
    ),
    short,
  );
  await evaluate("navigator.clipboard.write = window.originalRichWrite");
  console.log(
    "PASS: held rich rejection serializes both real and programmatic copy actions through actual fallback; clipboard and feedback agree; URL action recovers",
  );
  // Exercise the actual synchronous copy-event fallback without ClipboardItem.
  await evaluate("window.ClipboardItem = undefined");
  await click(".title");
  await expect
    .poll(() => evaluate('document.querySelector("#feedback").textContent'))
    .toContain("Formatted link copied.");
  assertEqual(
    execFileSync(
      "xclip",
      ["-selection", "clipboard", "-t", "text/plain", "-o"],
      {
        encoding: "utf8",
      },
    ),
    short,
  );
  const fallbackHtml = execFileSync(
    "xclip",
    ["-selection", "clipboard", "-t", "text/html", "-o"],
    { encoding: "utf8" },
  );
  if (
    !fallbackHtml.includes(
      `<a href="${short}">Article &amp; Notes &lt;proof&gt;</a>`,
    )
  )
    throw new Error("Fallback did not write HTML");
  console.log(
    "READBACK no-ClipboardItem fallback:",
    JSON.stringify({ html: fallbackHtml, text: short }),
  );
  assertEqual(requests.length, 2);
  await evaluate("document.execCommand = () => false");
  await click(".title");
  await expect
    .poll(() => evaluate('document.querySelector("#feedback").textContent'))
    .toContain("Formatted copy failed.");
  console.log(
    "PASS: denied automatic copy retains result; explicit retry writes actual clipboard without another POST; real rich-copy fallback and truthful rejection",
  );

  status = 401;
  held = Promise.resolve();
  ({ evaluate, click, sessionId } = await openPopup());
  await expect
    .poll(() => evaluate('document.querySelector("#app").textContent'))
    .toContain("Access token not accepted.");
  await capturePopup("api-error", { evaluate, sessionId });
  assertEqual(requests.length, 3);
  assertEqual(await evaluate('document.querySelector(".title")'), null);
  console.log(
    "PASS: authenticated API failure renders recovery, not a success or a short link",
  );

  await target.bringToFront();
  await target.goto("chrome://version");
  ({ evaluate, click, sessionId } = await openPopup());
  await expect
    .poll(() => evaluate('document.querySelector("#app").textContent'))
    .toContain("Open an HTTP or HTTPS page");
  assertEqual(requests.length, 3);
  await click("#settings");
  await settings.bringToFront();
  await settings.reload();
  await expect(settings.locator("#service")).toHaveValue(origin);
  await settings.evaluate(
    (service) =>
      chrome.storage.local.set({
        settings: { service, token: "legacy-session-credential" },
      }),
    origin,
  );
  await settings.reload();
  await expect(settings.locator("#service")).toHaveValue(origin);
  await expect(settings.locator("#token")).toHaveValue("");
  await expect(settings.locator("#status")).toContainText(
    "Account → Access tokens",
  );
  await settings.screenshot({
    path: `${artifacts}/settings-legacy-migration.png`,
  });
  await settings.locator("#forget").click();
  await expect(settings.locator("#status")).toContainText(
    "Settings forgotten.",
  );
  assertEqual(
    await settings.evaluate(
      async () => (await chrome.storage.local.get("settings")).settings,
    ),
    undefined,
  );
  assertEqual(
    await settings.evaluate(() =>
      chrome.permissions.contains({ origins: ["http://127.0.0.1/*"] }),
    ),
    false,
  );
  await settings.setViewportSize({ width: 320, height: 420 });
  assertEqual(
    await settings.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await captureSettings("forgotten");
  ({ evaluate, click, sessionId } = await openPopup());
  await expect
    .poll(() => evaluate('document.querySelector("#app").textContent'))
    .toContain("Set your service URL");
  assertEqual(requests.length, 3);
  await capturePopup("setup", { evaluate, sessionId });
  await writeFile(
    `${artifacts}/visual-metrics.json`,
    JSON.stringify(
      {
        sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        artifactSha256: createHash("sha256")
          .update(
            await readFile(new URL("../dist/firefox.zip", import.meta.url)),
          )
          .digest("hex"),
        observations: visualMeasurements,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: unsupported active tab performs no request; Settings/forget readback revokes host grant; missing settings does not create; narrow settings and light/dark popup geometry",
  );
} finally {
  wire?.close();
  release();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}

function assertEqual(actual, expected) {
  if (actual !== expected)
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    message.error
      ? call.reject(new Error(JSON.stringify(message.error)))
      : call.resolve(message.result);
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timed out: ${method}`));
        }, 8000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error("CDP closed"));
      }
      pending.clear();
      socket.close();
    },
  };
}
