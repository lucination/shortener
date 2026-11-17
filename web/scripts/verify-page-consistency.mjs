// Render every current controlled story and native document, without live effects.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const base = process.env.PAGE_STORY_BASE || "http://127.0.0.1:6006";
const output = process.env.PAGE_EVIDENCE_DIR;
assert.ok(output, "explicit evidence directory required");
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "isolated loopback fixtures only",
);
await mkdir(output, { recursive: true });
const index = await (await fetch(`${base}/index.json`)).json();
const stories = Object.values(index.entries).filter(
  (e) =>
    e.type === "story" &&
    (!process.env.PAGE_ONLY || e.id.includes(process.env.PAGE_ONLY)),
);
assert.ok(stories.length > 0);
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const observations = [],
  failures = [],
  errors = [],
  forbidden = [];
const checks = async (
  page,
  name,
  theme,
  width,
  { criticalOnly = false, inert = false } = {},
) => {
  const result = await page.evaluate(() => {
    const root = document.querySelector("#storybook-root") || document.body;
    const rect = (n) => {
      const { x, y, width, height } = n.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      documentWidth: document.documentElement.scrollWidth,
      background: getComputedStyle(document.body).backgroundColor,
      font: getComputedStyle(root).fontFamily,
      headings: [...root.querySelectorAll("h1,h2,h3")].map((n) => ({
        text: n.textContent,
        size: parseFloat(getComputedStyle(n).fontSize),
        ...rect(n),
      })),
      controls: [
        ...root.querySelectorAll("button,input,select,textarea,a"),
      ].map((n) => ({
        tag: n.tagName,
        text: n.textContent.trim(),
        ...rect(n),
        font: getComputedStyle(n).fontFamily,
        display: getComputedStyle(n).display,
        table: !!n.closest("table"),
        icon: !!n.querySelector("svg"),
        title: n.title,
      })),
      scripts: root.querySelectorAll("script").length,
      nav: root.querySelectorAll("nav").length,
      forms: root.querySelectorAll("form").length,
      frames: root.querySelectorAll("iframe").length,
      rootChildren: root.children.length,
    };
  });
  const receipt = { name, theme, width, criticalOnly, inert, ...result };
  observations.push(receipt);
  try {
    assert.ok(
      result.documentWidth <= width + 1,
      `document overflow ${result.documentWidth}`,
    );
    assert.match(result.font, /system-ui|sans-serif/);
    for (const h of result.headings) {
      assert.ok(h.size <= 20, `inconsistent heading size ${h.text}: ${h.size}`);
      assert.ok(
        h.x >= -1 && h.x + h.width <= width + 1,
        `heading outside viewport: ${h.text}`,
      );
    }
    for (const control of result.controls) {
      assert.ok(
        !/^[+←→×✕⋯]\s|^[×✕⋯…]$/.test(control.text),
        `text UI symbol: ${control.text}`,
      );
      if (
        control.tag !== "A" &&
        !control.table &&
        control.display !== "none" &&
        control.width > 0
      ) {
        assert.ok(
          control.x >= -1 && control.x + control.width <= width + 1,
          `control outside viewport: ${control.text || control.tag}`,
        );
        if (control.tag === "BUTTON")
          assert.ok(
            control.height >= 28 && control.height <= 34,
            `control density ${control.text}: ${control.height}`,
          );
      }
    }
    if (inert) {
      assert.equal(result.scripts, 0);
      assert.equal(result.nav, 0);
      assert.equal(result.forms, 0);
    }
    assert.notEqual(
      result.background,
      "rgba(0, 0, 0, 0)",
      "explicit themed surface",
    );
  } catch (error) {
    failures.push({ name, theme, width, error: error.message });
  }
};
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", (route) => {
    forbidden.push(route.request().url());
    return route.abort();
  });
  for (const theme of ["light", "dark"])
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 1000 });
      for (const story of stories) {
        await page.goto("about:blank");
        await page.goto(`${base}/iframe.html?id=${story.id}&viewMode=story`);
        await page.waitForFunction(() => {
          const root = document.querySelector("#storybook-root");
          return (
            root && (root.textContent.trim() || root.querySelector("iframe"))
          );
        });
        await page.evaluate(() => document.fonts.ready);
        await checks(page, story.id, theme, width);
        for (const frame of page.frames().slice(1)) {
          if (frame.url() === "about:srcdoc")
            await checks(frame, `${story.id}/native-frame`, theme, width);
        }
        await page.screenshot({
          path: `${output}/${story.id}-${theme}-${width}.png`,
        });
      }
    }
  // Exercise exact native templates without the optional static stylesheet.
  // This is presentation proof, not a claim to have run the Rust router.
  const read = (name) =>
    readFile(
      new URL(`../src/lib/presentation/${name}`, import.meta.url),
      "utf8",
    );
  const template = await read("native-document.html");
  const critical = await read("native-critical.css").catch(() => "");
  const fill = (text, values) =>
    text.replace(/\{([a-z]+)\}/g, (_, key) => values[key] ?? "");
  const native = [
    [
      "native-password",
      fill(await read("native-password.html"), { code: "fixture", query: "" }),
    ],
    [
      "native-preview",
      fill(await read("native-preview.html"), {
        code: "fixture",
        query: "",
        title: "Notes",
        description: "Fixture preview",
        destination: "https://example.org/notes",
      }),
    ],
    [
      "native-unlock-error",
      fill(await read("native-unlock-error.html"), {
        code: "fixture",
        query: "",
      }),
    ],
    ["native-management-denied", "<h1>Link not found</h1>"],
    [
      "native-static-unavailable",
      "<h1>Application unavailable</h1><p>Static application files are missing.</p>",
    ],
    [
      "native-development-unavailable",
      "<h1>Development frontend unavailable</h1>",
    ],
  ];
  await page.route("**/presentation.css", (route) => route.abort());
  for (const theme of ["light", "dark"])
    for (const width of [1440, 390]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, content] of native) {
        await page.goto("about:blank");
        await page.setContent(
          fill(template, { title: name, content, style: critical }),
        );
        await checks(page, name, theme, width, {
          criticalOnly: true,
          inert: /denied|unavailable/.test(name),
        });
        await page.screenshot({
          path: `${output}/${name}-${theme}-${width}.png`,
        });
      }
    }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/page-matrix.json`,
  JSON.stringify(
    {
      stories: stories.map(({ id, title, name }) => ({ id, title, name })),
      observations,
      failures,
      errors,
      forbidden,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    stories: stories.length,
    cases: observations.length,
    failures,
    errors,
    forbidden,
  }),
);
assert.deepEqual(errors, []);
assert.deepEqual(forbidden, []);
assert.equal(failures.length, 0, "page consistency regressions");
