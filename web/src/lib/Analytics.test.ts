import { it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import Analytics from "./Analytics.svelte";
import { simulatedEventRows, simulatedStatsView } from "./fixtures";
import { simulatedStats } from "./fixtures";
import { statsView } from "./mappings";
it("presents overview and events as an accessible tablist under one date range", async () => {
  const ontab = vi.fn();
  const range = { from: "2026-11-08", to: "2026-11-14" };
  const view = {
    label: "Notes",
    tab: "events" as const,
    stats: { kind: "ready" as const, value: simulatedStatsView },
    events: {
      kind: "ready" as const,
      value: { range, rows: simulatedEventRows },
    },
  };
  const v = render(Analytics, { range, view, ontab });
  expect(v.getByRole("tablist", { name: "Statistics views" })).toBeTruthy();
  const tabs = v.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Events"]);
  expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
    "false",
    "true",
  ]);
  expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["-1", "0"]);
  const panel = v.getByRole("tabpanel");
  expect(panel.id).toBe(tabs[1].getAttribute("aria-controls"));
  expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1].id);
  // The shared date controls sit above both views; the event table is the panel.
  expect(v.getAllByLabelText("From")).toHaveLength(1);
  expect(panel.querySelectorAll("tbody tr")).toHaveLength(
    simulatedEventRows.length,
  );
  expect(panel.querySelector(".so-total")).toBeNull();
  expect(v.getByText("2026-11-08 — 2026-11-14 · UTC")).toBeTruthy();
  await fireEvent.click(tabs[1]);
  expect(ontab).not.toHaveBeenCalled();
  await fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
  expect(ontab).toHaveBeenLastCalledWith("overview");
  expect(document.activeElement).toBe(tabs[0]);
  await fireEvent.keyDown(tabs[1], { key: "Home" });
  expect(ontab).toHaveBeenLastCalledWith("overview");
  await fireEvent.click(tabs[0]);
  expect(ontab).toHaveBeenCalledTimes(3);
  await v.rerender({ range, view: { ...view, tab: "overview" }, ontab });
  expect(v.getByRole("tabpanel").querySelectorAll(".so-total")).toHaveLength(3);
  expect(v.container.querySelector("tbody")).toBeNull();
});
it("keeps the events state beside its view with its own retry", async () => {
  const onretryevents = vi.fn();
  const onapply = vi.fn();
  const v = render(Analytics, {
    range: { from: "2026-11-08", to: "2026-11-14" },
    view: {
      label: "Notes",
      tab: "events",
      stats: { kind: "pending" },
      events: { kind: "error", message: "Events paused" },
    },
    onretryevents,
    onapply,
  });
  expect(v.getByRole("tabpanel").textContent).toContain("Events paused");
  await fireEvent.click(v.getByRole("button", { name: "Retry events" }));
  expect(onretryevents).toHaveBeenCalledOnce();
  expect(onapply).not.toHaveBeenCalled();
});
it("keeps clicks-only overview and all-event totals without explanatory subtitles", () => {
  const v = render(Analytics, {
    range: { from: "2026-11-08", to: "2026-11-14" },
    view: {
      label: "Notes",
      tab: "overview",
      events: { kind: "pending" },
      stats: { kind: "ready", value: simulatedStatsView },
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
    view: {
      label: "Notes",
      tab: "overview",
      events: { kind: "pending" },
      stats: { kind: "ready", value },
    },
  });
  expect(v.getByText("2026-11-01: 3 clicks", { exact: true })).toBeTruthy();
});
