// Controlled production Dashboard in existing Storybook fixtures. No API writes.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.DASHBOARD_STORY_BASE || "http://127.0.0.1:6006";
const output = process.env.DASHBOARD_EVIDENCE_DIR;
assert.ok(output, "explicit evidence directory required");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const observations = [],
  failures = [],
  errors = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const theme of ["light", "dark"])
    for (const width of [1280, 1920, 390])
      for (const mode of ["manage", "read-only"]) {
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width, height: 844 });
        await page.goto(
          `${base}/iframe.html?id=workspace-links--${mode === "manage" ? "selected" : "read-only"}&viewMode=story`,
        );
        await page.locator(".grid-table tbody tr").first().waitFor();
        await page.waitForFunction(
          (manage) =>
            document.querySelector(".grid-table tbody tr")?.children.length ===
            (manage ? 6 : 4),
          mode === "manage",
        );
        // Component stories normally use a character-width specimen frame. Exercise
        // production viewport space rather than that unrelated preview constraint.
        await page.locator("#storybook-root").evaluate((root) => {
          root.style.maxWidth = "none";
          root.style.margin = "0";
          root.style.padding = "14px";
        });
        await page.evaluate(() => document.fonts.ready);
        if (mode === "read-only" && width === 390) {
          // Force two post-threshold scroll positions even without action cells.
          await page
            .locator("tbody code")
            .first()
            .evaluate((node) => {
              node.textContent =
                "example.com/long-read-only-link-address-for-horizontal-scroll-coverage";
            });
        }
        const geometry = await page.evaluate(() => {
          const table = document.querySelector(".grid-table");
          const rect = (node) => {
            const { x, y, width, height } = node.getBoundingClientRect();
            return { x, y, width, height };
          };
          const textWidth = (node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range.getBoundingClientRect().width;
          };
          return {
            headers: [...table.querySelectorAll("th")].map(rect),
            headerTextWidths: [...table.querySelectorAll("th")].map(textWidth),
            rows: [...table.querySelectorAll("tbody tr")].map((row) =>
              [...row.children].map((cell) => ({
                ...rect(cell),
                text: cell.textContent.trim(),
                label: cell.querySelector("strong")?.textContent ?? null,
                textWidth: textWidth(cell),
                checkbox: cell.querySelector("input")
                  ? rect(cell.querySelector("input"))
                  : null,
                icon: cell.querySelector("svg")
                  ? rect(cell.querySelector("svg"))
                  : null,
                button: cell.querySelector("button")
                  ? rect(cell.querySelector("button"))
                  : null,
                actions: [...cell.querySelectorAll(".row-actions > *")].map(
                  (node) => {
                    const button = node.matches("button")
                      ? node
                      : node.querySelector("button");
                    return {
                      ...rect(button),
                      text: button.textContent.trim(),
                      name: button.getAttribute("aria-label"),
                      haspopup: button.getAttribute("aria-haspopup"),
                      icon: rect(button.querySelector("svg")),
                    };
                  },
                ),
              })),
            ),
            headerCheckbox: table.querySelector("th input")
              ? rect(table.querySelector("th input"))
              : null,
            bulk: [
              ...document.querySelectorAll(".box-frame.toolbar button"),
            ].map((b) => ({
              ...rect(b),
              text: b.textContent.trim(),
              icon: b.querySelector("svg")
                ? rect(b.querySelector("svg"))
                : null,
              name: b.getAttribute("aria-label"),
              danger: b.classList.contains("btn-danger"),
            })),
            status: [...table.querySelectorAll(".link-status")].map((s) => ({
              label: s.textContent,
              badge: rect(s),
              cell: rect(s.closest("td")),
            })),
            font: getComputedStyle(table).fontFamily,
          };
        });
        const receipt = { theme, width, mode, geometry };
        observations.push(receipt);
        try {
          const offset = mode === "manage" ? 1 : 0;
          const aligned = (a, b) =>
            assert.ok(
              Math.abs(a.x - b.x) <= 1 && Math.abs(a.width - b.width) <= 1,
              "header/body alignment",
            );
          const centered = (a, b) =>
            assert.ok(
              Math.abs(a.x + a.width / 2 - b.x - b.width / 2) <= 1,
              "checkbox horizontally centered",
            );
          for (const row of geometry.rows) {
            for (let i = 0; i < offset + 4; i++)
              aligned(geometry.headers[i], row[i]);
            const clicksContent = Math.max(
              geometry.headerTextWidths[offset + 2],
              ...geometry.rows.map((r) => r[offset + 2].textWidth),
            );
            assert.ok(
              row[offset + 2].width <= clicksContent + 13,
              `Clicks not shrink-fit: ${row[offset + 2].width}`,
            );
            assert.ok(
              row[offset + 3].width <= 100,
              `Status not compact: ${row[offset + 3].width}`,
            );
            if (mode === "manage") {
              assert.ok(
                row[0].width <= 30,
                `Select not compact: ${row[0].width}`,
              );
              centered(row[0], row[0].checkbox);
              centered(geometry.headers[0], geometry.headerCheckbox);
              // One Actions column: Statistics, Edit, then the More actions trigger.
              assert.equal(row.length, 6);
              assert.equal(geometry.headers.length, 6);
              aligned(geometry.headers[5], row[5]);
              const cell = row[5];
              assert.ok(
                cell.width <= 220,
                `Actions not compact: ${cell.width}`,
              );
              assert.deepEqual(
                cell.actions.map((a) => [a.name, a.text, a.haspopup]),
                [
                  ["View statistics", "Statistics", null],
                  ["Edit link", "Edit", null],
                  [
                    `More actions for ${row[1].label}`,
                    "",
                    "menu",
                  ],
                ],
              );
              for (const a of cell.actions) {
                assert.equal(a.height, 32);
                assert.equal(a.y, cell.actions[0].y, "actions on one line");
                assert.ok(
                  a.x >= cell.x && a.x + a.width <= cell.x + cell.width + 0.5,
                  "action inside its cell",
                );
              }
              assert.equal(cell.actions[0].icon.width, 14);
              assert.equal(cell.actions[2].width, 32);
              assert.equal(cell.actions[2].icon.width, 16);
            } else {
              assert.equal(row.length, 4);
              assert.equal(row[0].checkbox, null);
            }
          }
          for (const s of geometry.status)
            assert.ok(
              Math.abs(
                s.badge.y + s.badge.height / 2 - s.cell.y - s.cell.height / 2,
              ) <= 1,
              "status badge vertically centered",
            );
          assert.deepEqual(
            geometry.status.map((s) => s.label),
            ["Enabled", "Enabled", "Disabled"],
          );
          if (mode === "manage") {
            assert.equal(geometry.bulk.length, 5);
            assert.equal(
              await page.getByText("2 selected", { exact: true }).count(),
              1,
            );
            assert.deepEqual(
              geometry.bulk.map((b) => [b.name, b.text]),
              [
                ["Enable selected links", "Enable"],
                ["Disable selected links", "Disable"],
                ["Set expiration", "Set expiration"],
                ["Set retention", "Set retention"],
                ["Delete selected links", "Delete"],
              ],
            );
            assert.deepEqual(
              geometry.bulk.map((b) => b.danger),
              [false, false, false, false, true],
            );
            for (const b of geometry.bulk) {
              assert.equal(b.height, 32);
              assert.equal(b.icon.width, 14);
              assert.ok(
                b.x >= 0 && b.x + b.width <= width,
                "bulk buttons within viewport",
              );
            }
            if (width >= 1280)
              for (const b of geometry.bulk)
                assert.equal(b.y, geometry.bulk[0].y, "bulk bar on one line");
            // The row menu opens within the viewport, focused on its first item.
            const trigger = page
              .getByRole("button", { name: /^More actions for / })
              .last();
            await trigger.focus();
            await page.keyboard.press("Enter");
            const menu = page.getByRole("menu");
            await menu.waitFor();
            const opened = await page.evaluate(() => {
              const m = document.querySelector('[role="menu"]');
              const { x, y, width, height } = m.getBoundingClientRect();
              return {
                x,
                y,
                width,
                height,
                items: [...m.querySelectorAll('[role="menuitem"]')].map((i) =>
                  i.textContent.trim(),
                ),
                focused: document.activeElement?.textContent.trim(),
                expanded: document
                  .querySelector('[aria-expanded="true"]')
                  ?.getAttribute("aria-label"),
              };
            });
            receipt.menu = opened;
            assert.deepEqual(opened.items, [
              "Copy address",
              "View events",
              "Enable link",
              "Delete link",
            ]);
            assert.equal(opened.focused, "Copy address");
            assert.ok(
              opened.x >= 0 &&
                opened.x + opened.width <= width &&
                opened.y >= 0 &&
                opened.y + opened.height <= 844,
              "menu within viewport",
            );
            await page.screenshot({
              path: `${output}/${theme}-${width}-${mode}-menu.png`,
            });
            await page.keyboard.press("Escape");
            assert.equal(await menu.count(), 0, "Escape closes the menu");
            assert.equal(
              await trigger.evaluate((t) => document.activeElement === t),
              true,
              "focus returns to the trigger",
            );
          } else {
            assert.equal(geometry.bulk.length, 0);
            assert.equal(geometry.headerCheckbox, null);
          }
          // At a wide viewport only the two identity/address columns absorb surplus.
          if (width === 1920)
            assert.ok(
              geometry.rows[0][offset].width +
                geometry.rows[0][offset + 1].width >
                1000,
              "identity/address remain flexible",
            );
          const sticky = [];
          if (width === 390) {
            for (const scroll of [120, 240]) {
              await page.locator(".table-scroll").evaluate((s, x) => {
                s.scrollLeft = x;
              }, scroll);
              await page.waitForTimeout(50);
              sticky.push(
                await page.evaluate(() => {
                  const s = document.querySelector(".table-scroll"),
                    h = s.querySelector("th.frozen-identity"),
                    b = s.querySelector("td.frozen-identity");
                  return {
                    scroll: s.scrollLeft,
                    h: h.getBoundingClientRect().x,
                    b: b.getBoundingClientRect().x,
                    moving: b.nextElementSibling.getBoundingClientRect().x,
                    position: getComputedStyle(h).position,
                    top: getComputedStyle(h).top,
                  };
                }),
              );
            }
            const [a, b] = sticky;
            assert.ok(b.scroll - a.scroll > 50, "real overflow");
            assert.ok(
              Math.abs(a.h - a.b) <= 1 && Math.abs(b.h - b.b) <= 1,
              "sticky header/body alignment",
            );
            assert.ok(Math.abs(a.h - b.h) <= 1, "identity stays frozen");
            assert.ok(
              Math.abs(b.moving - a.moving + b.scroll - a.scroll) <= 1,
              "other columns scroll",
            );
            assert.equal(b.position, "sticky");
            assert.equal(b.top, "auto");
          }
          receipt.sticky = sticky;
        } catch (error) {
          failures.push({ theme, width, mode, error: error.message });
        }
        await page.screenshot({
          path: `${output}/${theme}-${width}-${mode}.png`,
        });
      }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/geometry.json`,
  JSON.stringify({ observations, failures, errors }, null, 2),
);
console.log(JSON.stringify({ cases: observations.length, failures, errors }));
assert.deepEqual(errors, []);
assert.equal(failures.length, 0, "dashboard geometry regressions");
