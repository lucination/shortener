import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:6006";
const index = await (await fetch(`${origin}/index.json`)).json();
const stories = Object.values(index.entries).filter(
  (entry) => entry.type === "story",
);
assert(
  stories.every(
    (story) => !/simulat|fixture/i.test(story.title + " " + story.name),
  ),
  "Sidebar names must be plain product names",
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const results = [];
const failures = [];
const detail = [];
await mkdir("test-results/screenshots", { recursive: true });
try {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 1024, height: 480 },
  ]) {
    const page = await browser.newPage({ viewport });
    let errors = [];
    let requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) {
        requests.push(url.href);
        return route.abort();
      }
      return route.continue();
    });
    for (const story of stories) {
      errors = [];
      requests = [];
      await page.goto(`${origin}/iframe.html?id=${story.id}&viewMode=story`);
      await page.waitForFunction(
        () =>
          document.querySelector("#storybook-root")?.textContent?.trim()
            .length > 0,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(30);
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        root: document.querySelector("#storybook-root")?.getBoundingClientRect()
          .width,
        fontLoaded: document.fonts.check('500 16px "JetBrains Mono"'),
        banner:
          !!document.querySelector("#simulation-notice") ||
          /SIMULATED FIXTURES|SIMULATED INTERACTION HARNESS/.test(
            document.querySelector("#storybook-root")?.textContent ?? "",
          ),
      }));
      const row = {
        id: story.id,
        viewport,
        geometry,
        errors: [...errors],
        blockedRequests: [...requests],
      };
      results.push(row);
      if (
        errors.length ||
        requests.length ||
        geometry.document > viewport.width + 1 ||
        geometry.banner ||
        !geometry.fontLoaded
      )
        failures.push(row);
      if (story.id === "workspace-links--populated") {
        const measure = await page.evaluate(() => {
          const root = document.querySelector("#storybook-root");
          const rows = [...root.querySelectorAll("tbody tr")];
          const buttons = rows.map((row) =>
            [...row.querySelectorAll("button[data-action]")].map((button) => {
              const r = button.getBoundingClientRect();
              const svg = button.querySelector("svg")?.getBoundingClientRect();
              return {
                action: button.dataset.action,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                svg: svg ? { width: svg.width, height: svg.height } : null,
                cell: button.parentElement.tagName,
              };
            }),
          );
          const heights = rows.map((row) => row.getBoundingClientRect().height);
          const scroll = root.querySelector(".table-scroll");
          scroll.scrollLeft = 150;
          return {
            buttons,
            heights,
            scroll: {
              width: scroll.clientWidth,
              content: scroll.scrollWidth,
              left: scroll.scrollLeft,
            },
            typography: Object.fromEntries(
              ["h1", "strong", "th", "button", "td"].map((selector) => {
                const e = root.querySelector(selector);
                const s = getComputedStyle(e);
                return [
                  selector,
                  {
                    family: s.fontFamily,
                    weight: s.fontWeight,
                    size: s.fontSize,
                    lineHeight: s.lineHeight,
                    features: s.fontFeatureSettings,
                  },
                ];
              }),
            ),
          };
        });
        assert(
          measure.buttons.every((row) => row.length === 6),
          "Six dedicated actions per row",
        );
        for (let column = 0; column < 6; column++)
          assert(
            Math.max(...measure.buttons.map((row) => row[column].x)) -
              Math.min(...measure.buttons.map((row) => row[column].x)) <
              1,
            "Action columns align",
          );
        for (const row of measure.buttons) {
          assert(
            Math.max(...row.map((button) => button.y)) -
              Math.min(...row.map((button) => button.y)) <
              1,
            "Actions do not wrap",
          );
          assert(
            row.every(
              (button) =>
                button.cell === "TD" &&
                button.svg?.width === 16 &&
                button.svg.height === 16,
            ),
          );
        }
        assert(
          measure.heights.every((height) => height <= 80),
          "Rows remain compact",
        );
        if (viewport.width === 390)
          assert(
            measure.scroll.left > 0 &&
              measure.scroll.content > measure.scroll.width,
            "Phone table scrolls horizontally",
          );
        assert(measure.typography.h1.family.includes("JetBrains Mono"));
        assert.equal(measure.typography.h1.weight, "800");
        assert.equal(measure.typography.strong.weight, "800");
        assert.equal(measure.typography.th.weight, "700");
        assert.equal(measure.typography.button.weight, "600");
        assert.equal(measure.typography.td.weight, "500");
        await page.evaluate(
          () =>
            (document.querySelector(
              "#storybook-root .table-scroll",
            ).scrollLeft = 0),
        );
        detail.push({ kind: "actions", viewport, ...measure });
      }
      if (
        [
          "access-account--passkey-failed",
          "access-account--passkey-enrolled",
          "access-account--passkey-pending",
        ].includes(story.id)
      ) {
        const placement = await page.evaluate(() => {
          const section = document.querySelector(
            '#storybook-root [data-testid="passkey-section"]',
          );
          const feedback = section?.querySelector(
            '[data-testid="enrollment-feedback"]',
          );
          const r = section?.getBoundingClientRect();
          const f = feedback?.getBoundingClientRect();
          return {
            inside: !!feedback,
            section: r
              ? { top: r.top, bottom: r.bottom, height: r.height }
              : null,
            feedback: f ? { top: f.top, bottom: f.bottom } : null,
          };
        });
        assert(
          placement.inside &&
            placement.section &&
            placement.feedback &&
            placement.feedback.top >= placement.section.top &&
            placement.feedback.bottom <= placement.section.bottom,
          "Passkey feedback stays inside its section",
        );
        detail.push({
          kind: "passkey-placement",
          viewport,
          id: story.id,
          ...placement,
        });
        await page.screenshot({
          path: `test-results/screenshots/${story.id}-${viewport.width}.png`,
          fullPage: true,
        });
      }
      if (story.id === "analytics-stats-and-events--overview") {
        const measure = await page.evaluate(() => {
          const root = document.querySelector("#storybook-root");
          const elements = [
            ...root.querySelectorAll(
              ".date-toolbar input,.date-toolbar>button",
            ),
          ];
          return {
            controls: elements.map((e) => {
              const r = e.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
              };
            }),
            sectionWeight: getComputedStyle(root.querySelector("h2"))
              .fontWeight,
          };
        });
        assert.equal(measure.controls.length, 3);
        assert(
          Math.max(...measure.controls.map((r) => r.bottom)) -
            Math.min(...measure.controls.map((r) => r.bottom)) <
            1,
          "Date inputs and Apply dates share the same bottom",
        );
        assert.equal(measure.sectionWeight, "800");
        detail.push({ kind: "dates", viewport, ...measure });
      }
      if (
        [
          "workspace-links--populated",
          "analytics-stats-and-events--overview",
          "public-redirect-gates--preview",
          "workspace-editor--edit",
          "administration-console--users",
        ].includes(story.id)
      )
        await page.screenshot({
          path: `test-results/screenshots/${story.id}-${viewport.width}.png`,
          fullPage: true,
        });
    }
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(
    `${origin}/iframe.html?id=workbench-interactive--try-the-components&viewMode=story`,
  );
  await page
    .getByPlaceholder("Search links, destinations, aliases…")
    .fill("handbook");
  assert.equal(await page.getByText("Field notes", { exact: true }).count(), 0);
  await page
    .getByRole("button", { name: "+ Create link", exact: true })
    .click();
  await page.getByLabel("Destination URL").fill("https://example.org/test");
  await page.getByRole("button", { name: "Save link", exact: true }).click();
  await page.getByText("Link saved.", { exact: true }).waitFor();
  const fonts = await page.evaluate(async () => {
    const weights = [];
    for (const style of ["normal", "italic"])
      for (const weight of [100, 200, 300, 400, 500, 600, 700, 800]) {
        const query = `${style} ${weight} 16px "JetBrains Mono"`;
        const faces = await document.fonts.load(query);
        weights.push({
          style,
          weight,
          check: document.fonts.check(query),
          faces: faces.map((face) => ({
            family: face.family,
            weight: face.weight,
            style: face.style,
            status: face.status,
          })),
        });
      }
    return {
      weights,
      faces: [...document.fonts]
        .filter((face) => face.family === "JetBrains Mono")
        .map((face) => ({
          weight: face.weight,
          style: face.style,
          status: face.status,
        })),
    };
  });
  assert(
    fonts.weights.every(
      (item) =>
        item.check &&
        item.faces.length > 0 &&
        item.faces.every((face) => face.status === "loaded"),
    ),
    "Every normal and italic weight loads",
  );
  detail.push({ kind: "font-loads", ...fonts });
  const theme = await page.evaluate(() => {
    const result = {};
    for (const value of ["light", "dark"]) {
      document.documentElement.dataset.theme = value;
      result[value] = getComputedStyle(document.body).backgroundColor;
    }
    return result;
  });
  assert.equal(theme.light, "rgb(246, 245, 240)");
  assert.equal(theme.dark, "rgb(28, 30, 34)");
  detail.push({ kind: "themes", ...theme });
  await page.close();
  await writeFile(
    "test-results/browser.json",
    JSON.stringify(
      {
        stories: stories.length,
        canvases: results.length,
        results,
        detail,
        failures,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      stories: stories.length,
      canvases: results.length,
      failures: failures.length,
      interaction: "search/create/edit/save passed (isolated story state)",
      detail,
    }),
  );
  if (failures.length) {
    console.log(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
