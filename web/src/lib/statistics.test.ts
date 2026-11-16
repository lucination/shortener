import { it, expect } from "vitest";
import { completeDays } from "./statistics";
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
