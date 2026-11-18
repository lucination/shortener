import { expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import StatisticsOverview from "./StatisticsOverview.svelte";
import AnalyticsStory from "./story-harness/AnalyticsStory.svelte";
import {
  fixtureEventLimit,
  snapshots,
} from "./story-harness/statistics-fixtures";
const controls = {
  detail: { kind: "idle" } as const,
  onday: () => {},
  onretry: () => {},
};
it("scales discrete daily counts against labeled integer ticks including zero", () => {
  const stats = {
    ...snapshots[0],
    range: { from: "2026-11-08", to: "2026-11-10" },
    days: [
      { day: "2026-11-08", human: 0 },
      { day: "2026-11-09", human: 100 },
      { day: "2026-11-10", human: 294 },
    ],
  };
  const v = render(StatisticsOverview, {
    ...controls,
    state: { kind: "ready", value: stats },
    range: stats.range,
  });
  expect(
    [...v.container.querySelectorAll("[data-tick]")].map((e) =>
      e.getAttribute("data-tick"),
    ),
  ).toEqual(["0", "100", "200", "300"]);
  const bars = [...v.container.querySelectorAll("[data-day]")];
  expect(bars.length).toBe(3);
  expect(Number(bars[0].querySelector(".so-bar")?.getAttribute("height"))).toBe(
    0,
  );
  expect(
    Number(bars[1].querySelector(".so-bar")?.getAttribute("height")),
  ).toBeCloseTo(56);
  expect(
    Number(bars[2].querySelector(".so-bar")?.getAttribute("height")),
  ).toBeCloseTo(164.64);
});

it("shows exact hover detail and pins a tapped day until dismissed or period changes", async () => {
  const v = render(AnalyticsStory);
  const placeholder = () =>
    expect(
      v.container.querySelector(".so-detail-row > span")?.textContent,
    ).toBe("clicks/day");
  placeholder();
  const first = v.container.querySelector('[data-day="2026-10-18"]')!;
  await fireEvent.mouseEnter(first);
  expect(v.getByTestId("day-detail").textContent).toContain(
    "2026-10-18 · 65 clicks",
  );
  await fireEvent.mouseLeave(first);
  expect(v.queryByTestId("day-detail")).toBeNull();
  placeholder();
  await fireEvent.click(first);
  await fireEvent.mouseLeave(first);
  expect(v.getByTestId("day-detail").textContent).toContain(
    "2026-10-18 · 65 clicks",
  );
  await fireEvent.click(v.getByRole("button", { name: "Clear day" }));
  expect(v.queryByTestId("day-detail")).toBeNull();
  placeholder();
  await fireEvent.click(first);
  await fireEvent.change(v.getByLabelText("Period"), {
    target: { value: "7" },
  });
  expect(v.queryByTestId("day-detail")).toBeNull();
  placeholder();
});

it("keeps zero and single-day charts finite without fabricating activity", () => {
  const range = { from: "2026-11-08", to: "2026-11-08" };
  const stats = {
    ...snapshots[0],
    range,
    human: 0,
    days: [{ day: range.from, human: 0 }],
  };
  const v = render(StatisticsOverview, {
    ...controls,
    state: { kind: "ready", value: stats },
    range,
  });
  const bar = v.container.querySelector(".so-bar")!;
  expect(bar.getAttribute("height")).toBe("0");
  expect(Number(bar.getAttribute("x"))).toBe(376);
  expect(
    [...v.container.querySelectorAll("[data-tick]")].map((e) =>
      e.getAttribute("data-tick"),
    ),
  ).toEqual(["0", "1"]);
  expect(v.queryByText("No redirects in this date range.")).toBeNull();
});
it("does not turn an empty observation into a zero-filled daily series", () => {
  const v = render(StatisticsOverview, {
    ...controls,
    state: { kind: "ready", value: { ...snapshots[0], days: [], human: 0 } },
    range: snapshots[0].range!,
  });
  expect(v.getByText("No redirects in this date range.")).toBeTruthy();
  expect(v.container.querySelector(".so-chart")).toBeNull();
});

it("shows ranked category geometry relative to the maximum, with exact counts", () => {
  const stats = {
    ...snapshots[0],
    countries: [
      { label: "Zero", count: 0 },
      { label: "Small", count: 25 },
      { label: "Large", count: 100 },
    ],
  };
  const v = render(StatisticsOverview, {
    ...controls,
    state: { kind: "ready", value: stats },
    range: stats.range!,
  });
  const rows = [
    ...v.container.querySelectorAll(".so-ranking:first-child .so-rank-row"),
  ];
  expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
    "100",
    "25",
    "0",
  ]);
  expect(
    rows.map((row) => row.querySelector("i")?.getAttribute("style")),
  ).toEqual(["width: 100%;", "width: 25%;", "width: 0%;"]);
});

it("keeps invalid story date drafts until Apply and recovers after valid arbitrary dates", async () => {
  const v = render(AnalyticsStory);
  await fireEvent.input(v.getByLabelText("From"), { target: { value: "" } });
  expect(v.getByTestId("human-total").textContent).toBe("4,318");
  await fireEvent.click(v.getByRole("button", { name: "Apply dates" }));
  expect(v.getByText("Choose a valid inclusive date range.")).toBeTruthy();
  await fireEvent.input(v.getByLabelText("From"), {
    target: { value: "2026-11-09" },
  });
  await fireEvent.click(v.getByRole("button", { name: "Apply dates" }));
  expect(v.getByText("2026-11-09 — 2026-11-14 · UTC")).toBeTruthy();
  expect(v.container.querySelectorAll("[data-day]")).toHaveLength(6);
});

it("uses the actual application's primary-control style for Apply dates", () => {
  const v = render(AnalyticsStory);
  expect(
    v
      .getByRole("button", { name: "Apply dates" })
      .classList.contains("btn-primary"),
  ).toBe(true);
});

it("story events view filters the same fixture observations by the applied range", async () => {
  const v = render(AnalyticsStory, { initialTab: "events" });
  const days = () =>
    [...v.container.querySelectorAll("tbody tr td:first-child")].map((cell) =>
      cell.textContent!.slice(0, 10),
    );
  expect(days()).toHaveLength(fixtureEventLimit);
  await fireEvent.input(v.getByLabelText("From"), {
    target: { value: "2026-11-09" },
  });
  await fireEvent.input(v.getByLabelText("To"), {
    target: { value: "2026-11-09" },
  });
  await fireEvent.click(v.getByRole("button", { name: "Apply dates" }));
  expect(v.getByText("2026-11-09 — 2026-11-09 · UTC")).toBeTruthy();
  expect(days().length).toBeGreaterThan(0);
  expect(days().every((day) => day === "2026-11-09")).toBe(true);
  await fireEvent.click(v.getByRole("tab", { name: "Overview" }));
  expect(v.getByText("2026-11-09 — 2026-11-09 · UTC")).toBeTruthy();
  expect(v.container.querySelectorAll("[data-day]")).toHaveLength(1);
});
