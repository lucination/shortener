import { it, expect } from "vitest";
import { dailyChart, dayDetail, rankedBars } from "./statistics-chart";
import { recentRange, selectedPeriod } from "./statistics";
it("uses integer 1/2/5 tick steps and true zero heights for zero, small and large counts", () => {
  for (const count of [0, 1, 2, 5, 100, 294, 123456]) {
    const chart = dailyChart([
      { day: "2026-11-01", human: 0 },
      { day: "2026-11-02", human: count },
    ]);
    expect(chart.ticks[0].value).toBe(0);
    expect(chart.ticks.every((tick) => Number.isInteger(tick.value))).toBe(
      true,
    );
    expect(chart.maximum).toBeGreaterThanOrEqual(count);
    expect(chart.bars[0].height).toBe(0);
    expect(chart.bars[1].height).toBeCloseTo((count / chart.maximum) * 168);
  }
  expect(dailyChart([]).bars).toEqual([]);
});
it("pins, replaces, toggles and clears exact day identities without hover stealing a pin", () => {
  const hover = dayDetail({ kind: "idle" }, { kind: "enter", day: "one" });
  expect(dayDetail(hover, { kind: "leave" })).toEqual({ kind: "idle" });
  const pin = dayDetail(hover, { kind: "tap", day: "one" });
  expect(dayDetail(pin, { kind: "enter", day: "two" })).toEqual(pin);
  expect(dayDetail(pin, { kind: "leave" })).toEqual(pin);
  expect(dayDetail(pin, { kind: "tap", day: "two" })).toEqual({
    kind: "pinned",
    day: "two",
  });
  expect(dayDetail(pin, { kind: "tap", day: "one" })).toEqual({ kind: "idle" });
  expect(dayDetail(pin, { kind: "clear" })).toEqual({ kind: "idle" });
});
it("ranks at most twenty exact all-event observations without mutating source", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    label: String(index),
    count: index,
  }));
  expect(rankedBars(rows)).toHaveLength(20);
  expect(rankedBars(rows)[0]).toEqual({ label: "24", count: 24, width: 100 });
  expect(rows[0].count).toBe(0);
  expect(rankedBars([])).toEqual([]);
});
it("derives UTC inclusive presets from the adapter clock across leap days and year boundaries", () => {
  const clock = new Date("2028-03-01T23:59:59Z");
  expect(recentRange(7, clock)).toEqual({
    from: "2028-02-24",
    to: "2028-03-01",
  });
  expect(recentRange(7, new Date("2027-01-02T01:00:00Z"))).toEqual({
    from: "2026-12-27",
    to: "2027-01-02",
  });
  expect(selectedPeriod(recentRange(14, clock), clock)).toBe("14");
  expect(selectedPeriod({ from: "2020-01-01", to: "2020-01-03" }, clock)).toBe(
    "custom",
  );
});
