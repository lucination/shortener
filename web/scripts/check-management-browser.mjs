import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
function pngPixels(png) {
  let offset = 8,
    width,
    height,
    channels,
    compressed = [];
  while (offset < png.length) {
    const size = png.readUInt32BE(offset),
      type = png.toString("ascii", offset + 4, offset + 8),
      data = png.subarray(offset + 8, offset + 8 + size);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      channels = data[9] === 6 ? 4 : 3;
      assert([2, 6].includes(data[9]));
    }
    if (type === "IDAT") compressed.push(data);
    offset += size + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)),
    stride = width * channels,
    pixels = Buffer.alloc(height * stride);
  let at = 0;
  const paeth = (a, b, c) => {
    const p = a + b - c,
      pa = Math.abs(p - a),
      pb = Math.abs(p - b),
      pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0,
        b = y ? pixels[(y - 1) * stride + x] : 0,
        c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      pixels[y * stride + x] =
        (raw[at++] +
          [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]) &
        255;
    }
  }
  return (x, y) => [
    ...pixels.subarray(
      Math.floor(y) * stride + Math.floor(x) * channels,
      Math.floor(y) * stride + Math.floor(x) * channels + 3,
    ),
  ];
}
const base = process.env.MANAGEMENT_BASE;
assert.equal(new URL(base).hostname, "localhost");
const directory = "test-results/management";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const results = [];
const hostAdmissionProbes = JSON.parse(
  process.env.MANAGEMENT_HOST_PROBES || "[]",
);
try {
  // Same-host cookies are independent of port: a native denial must stay inert.
  for (const probe of hostAdmissionProbes) {
    const context = await browser.newContext({
      extraHTTPHeaders: probe.headers || {},
    });
    await context.addCookies([
      {
        name: "short_session",
        value: process.env.MANAGEMENT_SESSION,
        url: probe.base,
      },
    ]);
    const page = await context.newPage();
    const apiRequests = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url());
    });
    for (const suffix of ["statistics", "edit"]) {
      for (const reload of [false, true]) {
        const response = reload
          ? await page.reload()
          : await page.goto(`${probe.base}/Note-A/${suffix}`);
        assert.equal(response.status(), probe.status, probe.name);
        if (probe.status === 404) {
          await page.waitForLoadState("networkidle");
          assert.equal(response.headers()["cache-control"], "no-store");
          assert.equal(
            apiRequests.length,
            0,
            `${probe.name}: no management data fetch`,
          );
          assert.equal(
            await page.locator("script").count(),
            0,
            `${probe.name}: denial must not execute app`,
          );
          assert.equal(
            await page.getByText("Field notes", { exact: true }).count(),
            0,
          );
          assert.equal(
            await page.getByLabel("Destination URL", { exact: true }).count(),
            0,
          );
          assert.equal(
            apiRequests.length,
            0,
            `${probe.name}: no management data fetch`,
          );
        } else {
          await page
            .getByRole("heading", {
              name: suffix === "statistics" ? "Link statistics" : "Edit link",
              exact: true,
            })
            .waitFor();
        }
      }
    }
    await context.close();
  }
  for (const width of [1440, 390, 320])
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 850 },
        colorScheme,
        permissions: ["clipboard-read", "clipboard-write"],
      });
      await context.addCookies([
        {
          name: "short_session",
          value: process.env.MANAGEMENT_SESSION,
          url: base,
        },
      ]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base);
      await page.getByTitle("View statistics").last().waitFor();
      const scroll = page.locator(".table-scroll");
      const borders = [];
      for (const x of [0, 100, 220]) {
        await scroll.evaluate((node, x) => (node.scrollLeft = x), x);
        borders.push(
          await page.locator("th").evaluateAll((nodes) =>
            nodes.map((node) => ({
              text: node.textContent,
              box: node.getBoundingClientRect().toJSON(),
              bottom: getComputedStyle(node).borderBottomWidth,
              collapse: getComputedStyle(node.closest("table")).borderCollapse,
            })),
          ),
        );
        await page.screenshot({
          path: `${directory}/table-${width}-${colorScheme}-${x}.png`,
        });
        const row = borders.at(-1),
          identity = row.find((cell) => cell.text === "Link / destination"),
          other = row.find(
            (cell) =>
              cell.text !== "Select" &&
              cell.text !== "Link / destination" &&
              cell.box.right > identity.box.right + 12 &&
              cell.box.x < width - 20,
          );
        if (other) {
          const pixel = pngPixels(await page.screenshot());
          const sampleX = Math.min(
            width - 10,
            Math.max(other.box.x, identity.box.right) + 8,
          );
          const identityX = Math.max(20, identity.box.x + 20);
          const y = Math.floor(identity.box.bottom);
          const frozenLine = [-2, -1, 0, 1].map((dy) =>
            pixel(identityX, y + dy),
          );
          const scrollingLine = [-2, -1, 0, 1].map((dy) =>
            pixel(sampleX, y + dy),
          );
          await writeFile(
            `${directory}/divider-${width}-${colorScheme}-${x}.json`,
            JSON.stringify(
              { frozenLine, scrollingLine, identity, other },
              null,
              2,
            ),
          );
          assert.deepEqual(
            frozenLine,
            scrollingLine,
            "frozen and scrolling header divider pixels must match",
          );
        }
      }
      const frozen = borders.map((row) =>
        row.find((cell) => cell.text === "Link / destination"),
      );
      if (width < 600) {
        assert(
          Math.abs(frozen[1].box.x - frozen[2].box.x) <= 1,
          "identity must stay frozen after threshold",
        );
        assert(
          borders[2].find((cell) => cell.text === "Short address").box.x <
            borders[0].find((cell) => cell.text === "Short address").box.x,
          "other columns must scroll",
        );
      }
      // Separate cell borders paint with the sticky cell instead of the collapsed grid.
      assert.equal(
        frozen[2].collapse,
        "separate",
        "sticky divider must paint with its cell",
      );
      assert(borders[2].every((cell) => cell.bottom === frozen[2].bottom));
      const address = page.getByTitle("Copy short address").last();
      // Place the trigger in the visible, unfrozen strip before measuring layout.
      // A click on a trigger covered by the sticky identity legitimately auto-scrolls.
      await scroll.evaluate((node) => (node.scrollLeft = 0));
      const copyBox = await address.boundingBox();
      await scroll.evaluate(
        (node, amount) => (node.scrollLeft = amount),
        Math.max(0, copyBox.x + copyBox.width - width + 12),
      );
      // Delay only completion of the real clipboard adapter. Measure after the
      // browser's legitimate focus/scroll adjustment but before feedback renders.
      await page.evaluate(() => {
        const write = navigator.clipboard.writeText.bind(navigator.clipboard);
        window.__originalCopyWrite = write;
        window.__copyWritten = false;
        window.__copyCompletion = new Promise(
          (resolve) => (window.__releaseCopy = resolve),
        );
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: async (text) => {
            await write(text);
            window.__copyWritten = true;
            await window.__copyCompletion;
          },
        });
      });
      await address.click();
      await page.waitForFunction(() => window.__copyWritten === true);
      const beforeCopy = await page.locator("table").boundingBox();
      const toast = page.locator(".toast");
      assert.equal(await toast.count(), 0);
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        "https://localhost/Note-A",
      );
      await page.evaluate(() => window.__releaseCopy());
      await toast.waitFor();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        "https://localhost/Note-A",
      );
      assert.deepEqual(await page.locator("table").boundingBox(), beforeCopy);
      await page.evaluate(() =>
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: window.__originalCopyWrite,
        }),
      );
      const toastBox = await toast.boundingBox();
      assert(Math.abs(850 - toastBox.y - toastBox.height - 16) <= 1);
      const statusOffsets = await page
        .locator(".link-status")
        .evaluateAll((dots) =>
          dots.map((dot) => {
            const marker = dot.getBoundingClientRect(),
              cell = dot.closest("td").getBoundingClientRect();
            return Math.abs(
              marker.y + marker.height / 2 - cell.y - cell.height / 2,
            );
          }),
        );
      assert(statusOffsets.every((value) => value <= 1));
      await page.getByTitle("View statistics").last().click();
      await page.waitForURL(`${base}/Note-A/statistics`);
      await page.getByText("Daily activity").waitFor();
      assert.equal(await page.locator(".focused-dialog").count(), 0);
      assert.equal((await page.reload()).status(), 200);
      await page.getByTestId("human-total").waitFor();
      assert.equal(await page.locator(".so-apply.btn-primary").count(), 1);
      const primary = await page.locator(".so-apply").evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--dl-primary)";
        node.append(probe);
        const expected = getComputedStyle(probe).color;
        const actual = getComputedStyle(node).backgroundColor;
        probe.remove();
        return { expected, actual };
      });
      assert.equal(primary.actual, primary.expected);

      assert.deepEqual(
        await page.locator(".so-total > span").allTextContents(),
        ["Clicks", "Bot redirects", "Previews"],
      );
      assert.equal(
        await page
          .locator(".so-chart-panel [data-metric], .so-chart-panel select")
          .count(),
        0,
      );
      const day = page.locator(".so-chart [data-day]").last();
      await day.click();
      await page.getByTestId("day-detail").waitFor();
      const observed = await page.locator(".so-observed").innerText();
      const endDate = await page.getByLabel("To", { exact: true }).inputValue();
      await page.getByLabel("From", { exact: true }).fill(endDate);
      assert.equal(await page.locator(".so-observed").innerText(), observed);
      await page
        .getByRole("button", { name: "Apply dates", exact: true })
        .click();
      await page
        .getByText(`${endDate} — ${endDate} · UTC`, { exact: true })
        .waitFor();
      assert.equal(await page.getByTestId("day-detail").count(), 0);
      assert.equal(await page.locator("[data-day]").count(), 1);
      await page.getByLabel("Period").selectOption("28");
      await page.locator("[data-day]").first().waitFor();
      assert.equal(await page.locator("[data-day]").count(), 28);
      assert(await page.locator(".so-all-breakdowns").count());
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `${directory}/statistics-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.getByText("Back to links", { exact: false }).first().click();
      await page.getByTitle("Edit link").last().click();
      await page.waitForURL(`${base}/Note-A/edit`);
      await page.getByLabel("Destination URL", { exact: true }).waitFor();
      assert.equal((await page.reload()).status(), 200);
      await page.getByLabel("Destination URL", { exact: true }).waitFor();
      const geometry = await page
        .locator("form,input,select,form button")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            tag: node.tagName,
            box: node.getBoundingClientRect().toJSON(),
          })),
        );
      for (const item of geometry)
        assert(
          item.box.x >= 0 && item.box.right <= width + 1,
          JSON.stringify(item),
        );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      const editedTitle = `Edited notes ${width} ${colorScheme}`;
      await page.getByLabel("Title", { exact: true }).fill(editedTitle);
      await page
        .getByRole("button", { name: "Save link", exact: true })
        .click();
      await page.waitForURL(base + "/");
      const saved = await (
        await context.request.get(`${base}/api/links`)
      ).json();
      assert.equal(
        saved.items.find((link) =>
          link.addresses.some((address) => address.short_code === "Note-A"),
        ).title,
        editedTitle,
      );
      await page.getByTitle("Edit link").last().click();
      await page.getByLabel("Destination URL", { exact: true }).waitFor();
      await page.screenshot({
        path: `${directory}/edit-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.waitForURL(base + "/");
      await page.goBack();
      await page.getByLabel("Destination URL", { exact: true }).waitFor();
      assert.equal(
        (await page.goto(`${base}/${"a".repeat(64)}/edit`)).status(),
        200,
      );
      await page.getByText("a".repeat(64), { exact: true }).waitFor();
      assert.equal(
        await page.locator(".immutable-address").innerText(),
        "a".repeat(64),
      );
      assert.equal(
        await page.getByLabel("Custom alias", { exact: true }).count(),
        0,
      );
      const longBoxes = await page
        .locator("form,input,select,form button")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().toJSON()),
        );
      assert(
        longBoxes.every((box) => box.x >= 0 && box.right <= width + 1),
        JSON.stringify(longBoxes),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `${directory}/edit-long-alias-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.waitForURL(base + "/");
      assert.deepEqual(errors, []);
      results.push({
        width,
        colorScheme,
        exactNavigation: true,
        reload: 200,
        editorGeometry: geometry,
        tableBorders: borders,
        history: true,
      });
      await context.close();
    }
  for (const [name, value] of [
    ["short_session", null],
    ["short_session", "invalid"],
    ["short_session", process.env.MANAGEMENT_OTHER],
    ["short_admin", process.env.MANAGEMENT_ADMIN],
  ]) {
    const context = await browser.newContext();
    if (value) await context.addCookies([{ name, value, url: base }]);
    const page = await context.newPage();
    for (const suffix of ["statistics", "edit"]) {
      assert.equal((await page.goto(`${base}/Note-A/${suffix}`)).status(), 404);
      await page.getByText("Link not found", { exact: true }).waitFor();
      assert.equal((await page.reload()).status(), 404);
      assert.equal(await page.getByText("Send sign-in link").count(), 0);
    }
    await context.close();
  }
  await writeFile(
    `${directory}/receipt.json`,
    JSON.stringify(
      {
        status: "PASS",
        results,
        unauthorizedNative404: true,
        hostAdmissionProbes,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      viewports: results.length,
      unauthorizedNative404: true,
      directory,
    }),
  );
} finally {
  await browser.close();
}
