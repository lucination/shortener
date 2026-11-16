import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";
const evidence = process.env.EVIDENCE_DIR ?? "test-results/design-language";
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const failures = [];
const observations = [];
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => failures.push(error.message));
  await page.route("**/api/**", (route) => {
    failures.push(`Unexpected API call: ${route.request().url()}`);
    return route.abort();
  });
  for (const theme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: theme });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      for (const direction of ["precision", "paper", "studio"]) {
        await page.goto(
          `${base}/iframe.html?id=design-language--${direction}&viewMode=story`,
        );
        await page.locator(".dl-table tbody tr").first().waitFor();
        assert.equal(await page.locator(".dl-table tbody tr").count(), 3);
        const geometry = await page.evaluate(() => {
          const root = document.querySelector(".dl-workspace");
          const scroll = document.querySelector(".dl-table-scroll");
          const actions = [
            ...document.querySelectorAll(
              "tbody tr:first-child .dl-action button",
            ),
          ].map((button) => {
            const r = button.getBoundingClientRect();
            return { y: r.y, width: r.width, height: r.height };
          });
          const style = getComputedStyle(root);
          return {
            width: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            radius: style.getPropertyValue("--dl-radius").trim(),
            rowPadding: getComputedStyle(document.querySelector(".dl-table td"))
              .paddingTop,
            background: style.backgroundColor,
            tableClient: scroll.clientWidth,
            tableWidth: scroll.scrollWidth,
            actions,
          };
        });
        assert.ok(
          geometry.documentWidth <= width + 1,
          JSON.stringify(geometry),
        );
        assert.ok(
          geometry.actions.every(
            (action) =>
              action.y === geometry.actions[0].y &&
              action.width >= 29 &&
              action.height >= 29,
          ),
        );
        if (width === 390)
          assert.ok(geometry.tableWidth > geometry.tableClient);
        if (direction === "precision") {
          assert.equal(
            geometry.background,
            theme === "dark" ? "oklch(0.21 0.006 285.885)" : "oklch(0.985 0 0)",
            "Precision uses the exact skill canvas token",
          );
          assert.equal(
            geometry.rowPadding,
            "4px",
            "Precision uses compact 4px table padding",
          );
        }
        if (direction === "precision") {
          const baseline = await page.evaluate(() => {
            const style = (selector) =>
              getComputedStyle(document.querySelector(selector));
            const workspace = style(".dl-workspace");
            const button = style(".dl-page-heading button");
            const bar = style(".dl-appbar");
            return {
              surfaces: [
                ".dl-workspace",
                ".dl-appbar",
                ".dl-page-heading button:not(.dl-primary)",
                ".dl-mark",
              ].map((selector) => style(selector).backgroundColor),
              primary: style(".dl-page-heading .dl-primary").backgroundColor,
              font: workspace.fontFamily,
              size: workspace.fontSize,
              rowX: style(".dl-table td").paddingLeft,
              headerSize: style(".dl-table th").fontSize,
              headingSize: style(".dl-page-heading h2").fontSize,
              buttonSize: button.fontSize,
              buttonRadius: button.borderRadius,
              barY: bar.paddingTop,
              barX: bar.paddingLeft,
              shadows: [".dl-appbar", ".dl-list-panel"].map(
                (selector) => style(selector).boxShadow,
              ),
            };
          });
          const dark = theme === "dark";
          assert.deepEqual(
            baseline.surfaces,
            dark
              ? [
                  "oklch(0.21 0.006 285.885)",
                  "oklch(0.274 0.006 286.033)",
                  "oklch(0.37 0.013 285.805)",
                  "oklch(0.442 0.017 285.786)",
                ]
              : [
                  "oklch(0.985 0 0)",
                  "oklch(1 0 0)",
                  "oklch(0.985 0 0)",
                  "oklch(0.967 0.001 286.375)",
                ],
          );
          assert.equal(
            baseline.primary,
            dark ? "oklch(0.546 0.245 262.881)" : "oklch(0.623 0.214 259.815)",
          );
          assert.match(baseline.font, /Inter.*system-ui.*sans-serif/);
          assert.deepEqual(
            [
              baseline.size,
              baseline.headerSize,
              baseline.headingSize,
              baseline.buttonSize,
            ],
            ["13px", "11px", "15px", "12px"],
          );
          assert.deepEqual(
            [
              baseline.rowX,
              baseline.buttonRadius,
              baseline.barY,
              baseline.barX,
            ],
            ["6px", "4px", "10px", "14px"],
          );
          assert.deepEqual(baseline.shadows, ["none", "none"]);
          geometry.baseline = baseline;
        }
        assert.deepEqual(
          await page.locator(".dl-workspace :is(h1,h2,h3)").allTextContents(),
          ["Links"],
        );
        assert.equal(
          await page.locator(".dl-error,.dl-specimens,.dl-metrics").count(),
          0,
        );
        assert.equal(
          await page
            .getByRole("columnheader", { name: "Clicks", exact: true })
            .count(),
          1,
        );
        assert.doesNotMatch(
          await page.locator(".dl-workspace").innerText(),
          /humans?|bots|methodology/i,
        );
        observations.push({ theme, direction, ...geometry });
        await page.screenshot({
          path: `${evidence}/${direction}-${theme}-${width}.png`,
          fullPage: true,
        });
        for (const [title, identity, value] of [
          ["Clicks for Release handbook", "Release handbook", "386"],
          ["Show address for Field notes", "Field notes", "example.com/notes"],
        ]) {
          const trigger = page.getByTitle(title, { exact: true });
          await trigger.click();
          const popover = page.locator(".dl-popover");
          await popover.waitFor();
          assert.equal(
            await popover.getByText(identity, { exact: true }).count(),
            1,
          );
          if (title.startsWith("Clicks")) {
            assert.equal(
              await popover.getByText("Clicks", { exact: true }).count(),
              1,
            );
            assert.equal(
              await popover.getByText(value, { exact: true }).count(),
              1,
            );
          } else {
            assert.equal(await popover.locator("input").inputValue(), value);
            await popover
              .getByRole("button", { name: "Select address", exact: true })
              .click();
            assert.equal(
              await popover
                .locator("input")
                .evaluate((el) =>
                  el.value.slice(el.selectionStart, el.selectionEnd),
                ),
              value,
            );
          }
          assert.doesNotMatch(
            await popover.innerText(),
            /humans?|bots|previews|methodology|copied/i,
          );
          const position = await popover.boundingBox();
          const anchor = await trigger.boundingBox();
          assert.ok(
            position.x >= 8 && position.x + position.width <= width - 8,
          );
          assert.ok(
            Math.abs(position.y - (anchor.y + anchor.height + 4)) < 2 ||
              Math.abs(position.y + position.height - (anchor.y - 4)) < 2,
            JSON.stringify({ position, anchor }),
          );
          if (direction === "precision")
            await page.screenshot({
              path: `${evidence}/${title.startsWith("Clicks") ? "clicks" : "address"}-${theme}-${width}.png`,
              fullPage: true,
            });
          await page.keyboard.press("Escape");
          assert.equal(await popover.count(), 0);
        }
        await page
          .getByTitle("Clicks for Release handbook", { exact: true })
          .click();
        await page.locator(".dl-appbar").click();
        assert.equal(await page.locator(".dl-popover").count(), 0);
        await page
          .getByPlaceholder("Search links", { exact: true })
          .fill("release");
        assert.equal(await page.locator(".dl-table tbody tr").count(), 1);
        await page
          .getByTitle("Disable Release handbook", { exact: true })
          .click();
        await page.getByPlaceholder("Search links", { exact: true }).fill("");
        assert.equal(
          await page
            .getByTitle("Enable Release handbook", { exact: true })
            .count(),
          1,
        );
        await page.getByTitle("Edit Field notes", { exact: true }).click();
        await page
          .getByPlaceholder("A useful name")
          .fill("Revised field notes");
        await page
          .getByRole("button", { name: "Save link", exact: true })
          .click();
        assert.equal(
          await page.getByText("Revised field notes", { exact: true }).count(),
          1,
        );
        await page
          .getByRole("button", { name: "Create link", exact: true })
          .first()
          .click();
        await page.getByPlaceholder("A useful name").fill("Project guide");
        await page.getByPlaceholder("e.g. project-notes").fill("guide");
        await page.getByPlaceholder("https://example.org/page").fill("bad-url");
        assert.equal(await page.locator(".dl-modal").count(), 1);
        assert.equal(await page.locator(".dl-popover").count(), 0);
        await page
          .getByRole("button", { name: "Save link", exact: true })
          .click();
        assert.equal(await page.locator(".dl-modal .dl-error").count(), 1);
        assert.equal(
          await page.getByPlaceholder("A useful name").inputValue(),
          "Project guide",
        );
        await page
          .getByPlaceholder("https://example.org/page")
          .fill("https://example.org/guide");
        await page
          .getByRole("button", { name: "Save link", exact: true })
          .click();
        assert.equal(
          await page.getByText("example.com/guide", { exact: true }).count(),
          1,
        );
        await page
          .getByRole("button", { name: "Import / paste", exact: true })
          .click();
        await page
          .locator("textarea")
          .fill("https://example.org/one\nhttps://example.org/two");
        await page
          .getByRole("button", { name: "Import links", exact: true })
          .click();
        assert.equal(await page.locator(".dl-table tbody tr").count(), 6);
        await page
          .getByPlaceholder("Search links", { exact: true })
          .fill("nothing-matches-this");
        assert.equal(
          await page.getByText("No matching links", { exact: true }).count(),
          1,
        );
        await page
          .getByRole("button", { name: "Clear search", exact: true })
          .click();
        assert.equal(await page.locator(".dl-table tbody tr").count(), 6);
      }
    }
  }
  for (const viewport of [
    { width: 1440, height: 950 },
    { width: 390, height: 844 },
    { width: 390, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(
      `${base}/iframe.html?id=design-language--compare&viewMode=story`,
    );
    await page.locator('.dl-workspace[data-direction="precision"]').waitFor();
    assert.equal(await page.locator(".dl-workspace").count(), 1);
    assert.deepEqual(
      await page.locator(".dl-workspace :is(h1,h2,h3)").allTextContents(),
      ["Links"],
    );
    assert.equal(
      await page
        .locator(
          ".dl-review,.dl-specimens,.dl-error,.dl-metrics,.dl-heading-dot,.dl-eyebrow",
        )
        .count(),
      0,
    );
    assert.doesNotMatch(
      await page.locator(".dl-workspace").innerText(),
      /humans?|bots|methodology|language kit|skill baseline|personal workspace/i,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `${evidence}/selected-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Create link", exact: true })
      .click();
    const modal = page.locator(".dl-modal");
    assert.equal(await modal.count(), 1);
    assert.ok(
      await page
        .getByPlaceholder("A useful name")
        .evaluate((el) => el === document.activeElement),
    );
    await page.getByPlaceholder("A useful name").fill("Cancelled draft");
    const bounds = await modal.boundingBox();
    assert.ok(bounds.x >= 8 && bounds.x + bounds.width <= viewport.width - 8);
    assert.ok(bounds.y >= 8 && bounds.y + bounds.height <= viewport.height - 8);
    await page.screenshot({
      path: `${evidence}/modal-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await modal.count(), 0);
    assert.equal(
      await page.getByText("Cancelled draft", { exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "Create link", exact: true })
      .click();
    await page.locator(".dl-backdrop").click({ position: { x: 2, y: 2 } });
    assert.equal(await modal.count(), 0);
    await page
      .getByRole("button", { name: "Create link", exact: true })
      .click();
    await page.keyboard.press("Escape");
    assert.equal(await modal.count(), 0);
  }
  assert.equal(
    new Set(
      observations
        .filter((o) => o.theme === "light" && o.width === 1440)
        .map((o) => `${o.radius}/${o.rowPadding}`),
    ).size,
    3,
  );
  assert.equal(failures.length, 0, failures.join("\n"));
  await writeFile(
    `${evidence}/observations.json`,
    JSON.stringify(observations, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        individualCanvases: 12,
        selectedDefault: "clean Precision at desktop/phone/short phone",
        interactions:
          "search/toggle/edit/create/validation/import/empty + contextual details/dismissal/modal cancel",
        screenshots: 26,
        apiCalls: 0,
        pageErrors: failures,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
