import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { connect } from "./access-token-cdp.mjs";
export async function nativePopup(base, session, directory) {
  const request = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        cookie: `short_session=${session}`,
        origin: base,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert(response.ok, `Native ${method} ${path}: ${response.status}`);
    return response.json();
  };
  const issued = await request("POST", "/api/account/tokens", {
    name: "Native toolbar fixture",
    expires_in_days: 30,
  });
  const before = await request("GET", "/api/links");
  const extension = fileURLToPath(
    new URL("../../extension/dist/chrome", import.meta.url),
  );
  const id = [
    ...createHash("sha256").update(extension).digest("hex").slice(0, 32),
  ]
    .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
    .join("");
  const profile = await mkdtemp(`${tmpdir()}/shortener-native-popup-`);
  let context, wire;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: false,
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
    await settings.locator("#service").fill(base);
    await settings.locator("#token").fill(issued.token);
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
    await expect(settings.locator("#token")).toHaveValue("");
    const page = await context.newPage();
    await page.goto(base);
    await page.bringToFront();
    const [port, endpoint] = (
      await readFile(`${profile}/DevToolsActivePort`, "utf8")
    )
      .trim()
      .split("\n");
    wire = await connect(`ws://127.0.0.1:${port}${endpoint}`);
    const open = async () => {
      await page.bringToFront();
      const windowId = execFileSync(
        "xdotool",
        ["search", "--onlyvisible", "--class", "chromium"],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")[0];
      execFileSync("xdotool", ["windowfocus", "--sync", windowId]);
      execFileSync("xdotool", ["key", "--clearmodifiers", "ctrl+shift+y"]);
      let target;
      await expect
        .poll(async () => {
          target = (await wire.send("Target.getTargets")).targetInfos.find(
            (t) => t.url === `chrome-extension://${id}/popup.html`,
          );
          return !!target;
        })
        .toBe(true);
      const { sessionId } = await wire.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      const evaluate = async (expression) => {
        const result = await wire.send(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        );
        assert(!result.exceptionDetails);
        return result.result.value;
      };
      return { target, sessionId, evaluate };
    };
    const popup = await open();
    await expect
      .poll(() =>
        popup.evaluate('document.querySelector("#app")?.textContent ?? ""'),
      )
      .toContain("URL copied.");
    const after = await request("GET", "/api/links");
    assert.equal(after.total, before.total + 1);
    const created = after.items.find(
      (item) => !before.items.some((old) => old.id === item.id),
    );
    assert.equal(created.destination, new URL(base).href);
    assert.equal(created.owner_id, 1);
    const short = await popup.evaluate('document.querySelector(".title").href');
    assert.equal(
      execFileSync("xclip", ["-selection", "clipboard", "-o"], {
        encoding: "utf8",
      }),
      short,
    );
    const shot = await wire.send(
      "Page.captureScreenshot",
      { format: "png" },
      popup.sessionId,
    );
    await writeFile(
      `${directory}/native-toolbar.png`,
      Buffer.from(shot.data, "base64"),
    );
    await wire.send("Target.closeTarget", { targetId: popup.target.targetId });
    await request("DELETE", `/api/account/tokens/${issued.metadata.id}`);
    const denied = await open();
    await expect
      .poll(() =>
        denied.evaluate('document.querySelector("#app")?.textContent ?? ""'),
      )
      .toContain("Access token not accepted.");
    assert.equal((await request("GET", "/api/links")).total, after.total);
    console.log(
      "Actual native Chromium toolbar: Account-issued token → native POST → real X11 clipboard → revoke → native rejection; no extra link.",
    );
  } finally {
    wire?.close();
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    await request("DELETE", `/api/account/tokens/${issued.metadata.id}`);
  }
}
