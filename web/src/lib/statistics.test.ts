import { it, expect } from "vitest";
import { completeDays, recentRange, validRange } from "./statistics";
import { statisticsHash, statisticsTab } from "./management";
it("keeps days at actual UTC positions and fills absent aggregate days with zero", () => {
  expect(
    completeDays(
      [
        { day: "2026-11-01", human: 3 },
        { day: "2026-11-03", human: 7 },
      ],
      { from: "2026-11-01", to: "2026-11-03" },
    ),
  ).toEqual([
    { day: "2026-11-01", human: 3 },
    { day: "2026-11-02", human: 0 },
    { day: "2026-11-03", human: 7 },
  ]);
  expect(completeDays([], { from: "bad", to: "2026-11-03" })).toEqual([]);
});

it("applies only inclusive ISO day ranges ending at the UTC clock day", () => {
  expect(validRange({ from: "2026-11-01", to: "2026-11-01" })).toBe(true);
  expect(validRange({ from: "2026-11-02", to: "2026-11-01" })).toBe(false);
  expect(validRange({ from: "", to: "2026-11-01" })).toBe(false);
  expect(recentRange(7, new Date("2026-11-18T12:00:00Z"))).toEqual({
    from: "2026-11-12",
    to: "2026-11-18",
  });
});
it("selects the events view only from the exact client-side fragment", () => {
  expect(statisticsTab("#events")).toBe("events");
  for (const hash of ["", "#", "#overview", "#Events", "#events/x"])
    expect(statisticsTab(hash)).toBe("overview");
  expect(statisticsHash("events")).toBe("#events");
  expect(statisticsHash("overview")).toBe("");
});
