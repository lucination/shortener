import { it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Analytics from "./Analytics.svelte";
import { simulatedStatsView } from "./fixtures";
import { simulatedStats } from "./fixtures";
import { statsView } from "./mappings";
it("keeps clicks-only overview and all-event totals without explanatory subtitles", () => {
  const v = render(Analytics, {
    range: { from: "2026-11-08", to: "2026-11-14" },
    view: {
      kind: "stats",
      label: "Notes",
      state: { kind: "ready", value: simulatedStatsView },
    },
  });
  expect(v.queryByText("Human redirects", { exact: true })).toBeNull();
  expect(v.queryByText(/Breakdowns include all recorded events/)).toBeNull();
  expect(v.getByText(/Dates are inclusive/)).toBeTruthy();
  expect(v.container.querySelector(".so-all-breakdowns")).toBeTruthy();
});
it("keeps the observed timeline period when unsubmitted date controls change", () => {
  const value = statsView({
    ...simulatedStats,
    from: "2026-11-01",
    to: "2026-11-03",
    daily: [
      {
        date: "2026-11-01",
        humans: 3,
        bots: 0,
        previews: 0,
        redirects: 3,
        daily_unique: 3,
      },
    ],
  });
  const v = render(Analytics, {
    range: { from: "2026-11-05", to: "2026-11-06" },
    view: { kind: "stats", label: "Notes", state: { kind: "ready", value } },
  });
  expect(v.getByText("2026-11-01: 3 clicks", { exact: true })).toBeTruthy();
});
