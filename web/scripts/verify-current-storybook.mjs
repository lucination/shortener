import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.STATISTICS_PREVIEW_URL ?? "http://127.0.0.1:6006";
const evidence = process.env.EVIDENCE_DIR ?? "test-results/current-storybook";
await mkdir(evidence, { recursive: true });
const index = await (await fetch(`${base}/index.json`)).json();
const entries = Object.values(index.entries);
assert(entries.some((entry) => entry.id === "workspace-statistics--overview"));
for (const entry of entries)
  assert(
    !/design-language|statistics-directions|creator-pages|Creator pages|Workbench|Precision\/|comparison|TrendFirst|CompactExplorer/i.test(
      `${entry.id} ${entry.title} ${entry.name}`,
    ),
    JSON.stringify(entry),
  );
const browser = await chromium.launch({
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [],
  errors = [],
  forbidden = [];
const dateControls = async (page) => {
  const result = await page.evaluate(() => {
    const bar = document.querySelector(".so-datebar");
    const inputs = [...bar.querySelectorAll('input[type="date"]')];
    const style = (node) => {
      const s = getComputedStyle(node),
        r = node.getBoundingClientRect();
      return {
        font: s.fontFamily,
        size: s.fontSize,
        color: s.color,
        background: s.backgroundColor,
        border: s.borderColor,
        radius: s.borderRadius,
        width: r.width,
        height: r.height,
        left: r.left,
        top: r.top,
        bottom: r.bottom,
        right: r.right,
        inset: parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth),
      };
    };
    return {
      reference: style(bar.querySelector("select")),
      muted: getComputedStyle(document.querySelector(".so-scope")).color,
      labels: [...bar.querySelectorAll("label")].map((node) => style(node)),
      inputs: inputs.map((node) => ({
        ...style(node),
        type: node.type,
        value: node.value,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
      })),
      apply: style(bar.querySelector("button")),
    };
  });
  // getComputedStyle(input, '::-webkit-…') returns the host style in Chromium.
  // Read the actual UA shadow nodes instead of accidentally testing host padding.
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { nodes } = await cdp.send("DOM.getFlattenedDocument", {
      depth: -1,
      pierce: true,
    });
    const native = [];
    for (const node of nodes) {
      const attrs = Object.fromEntries(
        Array.from({ length: (node.attributes?.length ?? 0) / 2 }, (_, i) =>
          node.attributes.slice(i * 2, i * 2 + 2),
        ),
      );
      if (
        ![
          "-webkit-datetime-edit",
          "-webkit-calendar-picker-indicator",
          "-webkit-datetime-edit-month-field",
          "-webkit-datetime-edit-day-field",
          "-webkit-datetime-edit-year-field",
        ].includes(attrs.pseudo)
      )
        continue;
      const { computedStyle } = await cdp.send("CSS.getComputedStyleForNode", {
        nodeId: node.nodeId,
      });
      const styles = Object.fromEntries(
        computedStyle.map(({ name, value }) => [name, value]),
      );
      const { model } = await cdp.send("DOM.getBoxModel", {
        nodeId: node.nodeId,
      });
      const bounds = {
        left: model.content[0],
        top: model.content[1],
        right: model.content[2],
        bottom: model.content[5],
      };
      native.push({
        pseudo: attrs.pseudo,
        bounds,
        font: styles["font-family"],
        size: styles["font-size"],
        color: styles.color,
        padding: ["top", "right", "bottom", "left"].map(
          (side) => styles[`padding-${side}`],
        ),
        opacity: styles.opacity,
        width: styles.width,
        height: styles.height,
      });
    }
    return { ...result, native };
  } finally {
    await cdp.detach();
  }
};
try {
  for (const colorScheme of ["light", "dark"])
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
        colorScheme,
        hasTouch: true,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (/\/api\//.test(request.url())) forbidden.push(request.url());
      });
      await page.goto(
        `${base}/iframe.html?id=workspace-statistics--overview&viewMode=story`,
        { waitUntil: "networkidle" },
      );
      await page.getByTestId("human-total").waitFor();
      assert.deepEqual(
        await page.locator(".so-total > strong").allTextContents(),
        ["4,318", "312", "458"],
      );
      assert.equal(await page.locator(".so-ranking").count(), 3);
      const hierarchy = await page
        .locator(".so-totals, .so-chart-panel, .so-all-breakdowns")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getBoundingClientRect().top),
        );
      assert(hierarchy[0] < hierarchy[1] && hierarchy[1] < hierarchy[2]);
      assert.equal(await page.locator(".so-chart [data-day]").count(), 28);
      assert.equal(await page.locator(".so-chart-panel button").count(), 0);
      assert.equal(
        await page
          .locator(".so-chart-panel")
          .getByText(/Bot redirects|Previews|not available/)
          .count(),
        0,
      );
      assert.equal(
        await page.locator(".so-detail-row > span").innerText(),
        "clicks/day",
      );
      const geometry = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        root: document.querySelector(".management-page").getBoundingClientRect()
          .width,
        font: getComputedStyle(document.querySelector(".statistics-overview"))
          .fontFamily,
        heading: getComputedStyle(
          document.querySelector(".statistics-overview h1"),
        ).fontSize,
      }));
      assert(geometry.page <= width, JSON.stringify(geometry));
      assert.equal(geometry.root, width);
      assert.equal(geometry.heading, "15px");
      assert.match(geometry.font, /system-ui/);
      const primary = await page.locator(".so-apply").evaluate((node) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--dl-primary)";
        node.append(probe);
        const expected = getComputedStyle(probe).color;
        const actual = getComputedStyle(node).backgroundColor;
        probe.remove();
        return { expected, actual };
      });
      assert.equal(
        primary.actual,
        primary.expected,
        "Apply uses the actual primary token in both themes",
      );
      assert.equal(
        await page
          .locator(".so-total strong")
          .first()
          .evaluate((node) => getComputedStyle(node).fontSize),
        "20px",
      );
      const controls = await dateControls(page);
      assert.equal(controls.native.length, 10);
      for (const input of controls.inputs) {
        assert.equal(input.height, 28);
        assert.equal(input.size, "12px");
        assert(input.width >= 136);
        assert(input.scrollWidth <= input.clientWidth);
      }
      for (const native of controls.native) {
        if (native.pseudo === "-webkit-calendar-picker-indicator") {
          assert.equal(native.width, "14px");
          assert.equal(native.height, "14px");
        } else {
          assert.equal(native.size, "12px");
          assert.deepEqual(native.padding, ["0px", "0px", "0px", "0px"]);
        }
      }
      // Read the actual UA segment geometry, not host pseudo-style approximations.
      const editors = controls.native.filter(
        (n) => n.pseudo === "-webkit-datetime-edit",
      );
      const months = controls.native.filter(
        (n) => n.pseudo === "-webkit-datetime-edit-month-field",
      );
      const pickers = controls.native.filter(
        (n) => n.pseudo === "-webkit-calendar-picker-indicator",
      );
      for (let i = 0; i < 2; i++) {
        const host = controls.inputs[i];
        assert(Math.abs(months[i].bounds.left - host.left - host.inset) <= 1);
        assert(
          Math.abs(
            (editors[i].bounds.top + editors[i].bounds.bottom) / 2 -
              host.top -
              host.height / 2,
          ) <= 1,
        );
        assert(
          Math.abs(
            (pickers[i].bounds.top + pickers[i].bounds.bottom) / 2 -
              host.top -
              host.height / 2,
          ) <= 1,
        );
      }
      const first = page.locator('[data-day="2026-10-18"]');
      await first.hover();
      assert.match(
        await page.getByTestId("day-detail").innerText(),
        /2026-10-18 · 65 clicks/,
      );
      await page.locator("#storybook-root h1").hover();
      assert.equal(await page.getByTestId("day-detail").count(), 0);
      await first.tap();
      await page.locator("#storybook-root h1").hover();
      assert.match(
        await page.getByTestId("day-detail").innerText(),
        /2026-10-18 · 65 clicks/,
      );
      await page.getByLabel("From", { exact: true }).fill("2026-11-09");
      assert.equal(await page.getByTestId("human-total").innerText(), "4,318");
      assert.match(
        await page.getByTestId("day-detail").innerText(),
        /2026-10-18/,
      );
      await page
        .getByRole("button", { name: "Apply dates", exact: true })
        .click();
      await page
        .getByText("2026-11-09 — 2026-11-14 · UTC", { exact: true })
        .waitFor();
      assert.equal(await page.getByTestId("day-detail").count(), 0);
      assert.equal(await page.locator("[data-day]").count(), 6);
      await page.getByLabel("Period").selectOption("7");
      assert.equal(await page.getByTestId("human-total").innerText(), "1,284");
      assert.equal(await page.locator("[data-day]").count(), 7);
      await page.screenshot({
        path: `${evidence}/overview-${width}-${colorScheme}.png`,
        fullPage: true,
      });
      for (const scenario of ["empty", "loading", "failed"]) {
        await page.goto(
          `${base}/iframe.html?id=workspace-statistics--${scenario}&viewMode=story`,
          { waitUntil: "networkidle" },
        );
        await page
          .getByRole("heading", { name: "Link statistics", exact: true })
          .waitFor();
        if (scenario === "empty") {
          await page.getByText("No redirects in this date range.").waitFor();
          assert.equal(await page.locator(".so-chart").count(), 0);
        }
        if (scenario === "loading")
          await page.getByText("Loading statistics…").waitFor();
        if (scenario === "failed")
          await page.getByRole("button", { name: "Retry dates" }).waitFor();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
      await page.goto(
        `${base}/iframe.html?id=access-sign-in--sign-in&viewMode=story`,
        { waitUntil: "networkidle" },
      );
      await page
        .getByRole("heading", { name: "Sign in", exact: true })
        .waitFor();
      assert.equal(
        await page
          .locator("#storybook-root h1")
          .evaluate((node) => getComputedStyle(node).fontSize),
        "20px",
      );
      assert.equal(
        (await page.getByLabel("Email", { exact: true }).boundingBox()).height,
        28,
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.goto(
        `${base}/iframe.html?id=workspace-editor--long-address&viewMode=story`,
        { waitUntil: "networkidle" },
      );
      await page
        .getByRole("heading", { name: "Edit link", exact: true })
        .waitFor();
      assert.equal(
        await page.getByLabel("Custom alias", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page.locator(".immutable-address").innerText(),
        "a".repeat(64),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      results.push({
        width,
        colorScheme,
        geometry,
        dateControls: controls,
        interactions: true,
        currentSignIn: true,
        immutableEditor: true,
      });
      await context.close();
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(forbidden, []);
  const report = {
    status: "PASS",
    storyCount: entries.filter((entry) => entry.type === "story").length,
    results,
    errors,
    forbidden,
  };
  await writeFile(`${evidence}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: "PASS",
      viewports: results.length,
      storyCount: report.storyCount,
      evidence,
    }),
  );
} finally {
  await browser.close();
}
