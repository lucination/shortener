import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

// Explicitly admitted synthetic demo only; no link/admin mutations.
assert.ok(process.env.STICKY_DEMO_BASE);
assert.ok(process.env.STICKY_EVIDENCE_DIR);
const output = process.env.STICKY_EVIDENCE_DIR;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const observations = [];
const failures = [];
try {
  const page = await browser.newPage();
  for (const theme of ["light", "dark"]) {
    for (const width of [390, 560, 1440]) {
      for (const target of [
        { name: "production", url: process.env.STICKY_DEMO_BASE },
        {
          name: "selected",
          url: "http://localhost:6006/iframe.html?id=workspace-links--selected&viewMode=story",
        },
        {
          name: "admin-users",
          url: "http://localhost:6006/iframe.html?id=administration-console--users&viewMode=story",
        },
        {
          name: "admin-links",
          url: "http://localhost:6006/iframe.html?id=administration-console--links&viewMode=story",
        },
      ]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 844 });
        await page.goto(target.url);
        await page.locator(".grid-table tbody td > strong").first().waitFor();
        // Long identity text exercises the actual production truncation rules.
        await page
          .locator(".grid-table tbody td > strong")
          .first()
          .evaluate((node) => {
            node.textContent =
              "Long identity label / release handbook with many details ".repeat(
                4,
              );
          });
        if (target.name === "admin-links") {
          await page
            .locator(".grid-table tbody code")
            .first()
            .evaluate((node) => {
              node.textContent =
                "example.com/long-read-only-link-address-for-horizontal-scroll-coverage";
            });
        }
        // Constrain desktop independently of the viewport, without changing its breakpoint.
        await page
          .locator(".table-scroll")
          .first()
          .evaluate((node) => {
            node.style.maxWidth = "500px";
            node.scrollLeft = 0;
          });
        const measure = () =>
          page.evaluate(() => {
            const scroller = document.querySelector(".table-scroll");
            const table = scroller.querySelector("table");
            const body = table.querySelector("tbody td:has(> strong)");
            const header =
              table.querySelector("thead tr").children[body.cellIndex];
            const rect = (node) => {
              const r = node.getBoundingClientRect();
              const s = getComputedStyle(node);
              return {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                position: s.position,
                left: s.left,
                top: s.top,
                zIndex: s.zIndex,
                background: s.backgroundColor,
              };
            };
            const h = rect(header);
            const b = rect(body);
            return {
              scrollLeft: scroller.scrollLeft,
              scrollWidth: scroller.scrollWidth,
              clientWidth: scroller.clientWidth,
              header: h,
              body: b,
              movingHeader: rect(header.nextElementSibling),
              movingBody: rect(body.nextElementSibling),
              headerOnTop:
                document
                  .elementFromPoint(Math.max(h.x + 8, 20), h.y + h.height / 2)
                  ?.closest("th") === header,
              bodyOnTop:
                document
                  .elementFromPoint(Math.max(b.x + 8, 20), b.y + b.height / 2)
                  ?.closest("td") === body,
            };
          });
        const origin = await measure();
        // The leading Select column scrolls away before identity reaches left: 0.
        await page
          .locator(".table-scroll")
          .first()
          .evaluate((node) => {
            node.scrollLeft = 120;
          });
        await page.waitForTimeout(80);
        const before = await measure();
        await page
          .locator(".table-scroll")
          .first()
          .evaluate((node) => {
            node.scrollLeft = 240;
          });
        await page.waitForTimeout(80);
        const after = await measure();
        const delta = after.scrollLeft - before.scrollLeft;
        const receipt = {
          target: target.name,
          theme,
          width,
          origin,
          before,
          after,
        };
        observations.push(receipt);
        try {
          assert.ok(delta > 50, "real horizontal overflow required");
          assert.ok(
            Math.abs(after.movingHeader.x - before.movingHeader.x + delta) < 1,
            "unfrozen header must move",
          );
          assert.ok(
            Math.abs(after.movingBody.x - before.movingBody.x + delta) < 1,
            "unfrozen body must move",
          );
          assert.ok(
            Math.abs(after.header.x - after.body.x) < 1,
            "frozen header must align with body after scroll",
          );
          assert.equal(after.header.width, after.body.width);
          assert.equal(
            after.header.top,
            "auto",
            "do not introduce vertical sticky behavior",
          );
          if (width <= 600) {
            assert.ok(
              Math.abs(after.body.x - before.body.x) < 1,
              "body remains frozen",
            );
            assert.ok(
              Math.abs(after.header.x - before.header.x) < 1,
              "header remains frozen",
            );
            assert.equal(after.header.position, "sticky");
            assert.ok(Number(after.header.zIndex) > Number(after.body.zIndex));
            assert.notEqual(after.header.background, "rgba(0, 0, 0, 0)");
            assert.ok(
              after.headerOnTop && after.bodyOnTop,
              "moving cells must not paint over frozen identity",
            );
          } else {
            assert.ok(
              Math.abs(after.body.x - before.body.x + delta) < 1,
              "preserve desktop unfrozen behavior",
            );
          }
        } catch (error) {
          failures.push({ ...receipt, error: error.message });
        }
        await page.screenshot({
          path: `${output}/${target.name}-${theme}-${width}.png`,
        });
      }
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/geometry.json`,
  JSON.stringify({ observations, failures }, null, 2),
);
console.log(
  JSON.stringify({
    cases: observations.length,
    failures: failures.map(({ target, theme, width, error }) => ({
      target,
      theme,
      width,
      error,
    })),
  }),
);
assert.equal(failures.length, 0, "sticky header geometry regressions");
