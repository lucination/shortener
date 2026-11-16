import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/svelte";
import Dashboard from "./Dashboard.svelte";
it("uses the selected shared presentation language in production and isolated components", () => {
  const css = readFileSync("src/app.css", "utf8");
  expect(css).toContain('@import "./lib/styles/presentation.css"');
  expect(css).not.toContain("font-family: var(--font-mono)");
  const v = render(Dashboard, { state: { kind: "ready", value: [] } });
  expect(v.getByRole("heading", { level: 1 }).textContent).toBe("Links");
});
