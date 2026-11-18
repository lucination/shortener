import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPresentation } from "./presentation-contract.mjs";
test("presentation guard rejects old typography, paper, square/double controls and narrow overflow", () => {
  const good = {
    font: "system-ui, sans-serif",
    size: "13px",
    background: "fixture app background",
    text: "fixture app text",
    palette: {
      background: "fixture app background",
      text: "fixture app text",
      border: "fixture line",
    },
    viewport: 320,
    scrollWidth: 320,
    header: { border: "solid", width: "1px", color: "fixture line" },
    controls: [
      {
        font: "system-ui",
        size: "12px",
        radius: "4px",
        border: "solid",
        borderWidth: "1px",
        borderColor: "fixture line",
        primary: false,
        height: 28,
        left: 14,
        right: 306,
        width: 292,
      },
    ],
    icons: [{ width: 14, height: 14 }],
  };
  assert.doesNotThrow(() => assertPresentation(good));
  for (const bad of [
    { ...good, font: "JetBrains Mono" },
    { ...good, background: "old paper" },
    { ...good, scrollWidth: 360 },
    { ...good, header: { border: "double", width: "3px" } },
    ...["radius", "height", "right"].map((k) => ({
      ...good,
      controls: [{ ...good.controls[0], [k]: k === "radius" ? "0px" : 360 }],
    })),
  ])
    assert.throws(() => assertPresentation(bad));
});
