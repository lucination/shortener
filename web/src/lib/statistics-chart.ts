import type { CountGroup, StatsView } from "./view-models";
export type ChartBar = Readonly<{
  day: string;
  count: number;
  x: number;
  width: number;
  y: number;
  height: number;
  hitX: number;
  hitWidth: number;
}>;
export type DailyChart = Readonly<{
  maximum: number;
  ticks: readonly { value: number; y: number }[];
  bars: readonly ChartBar[];
}>;
/** Integer 1/2/5 ticks; a true zero baseline, never smoothed or normalized counts. */
export function dailyChart(days: StatsView["days"]): DailyChart {
  const peak = Math.max(0, ...days.map((day) => day.human));
  const rough = Math.max(1, peak / 4);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10]
    .map((value) => value * power)
    .find((value) => value >= rough)!;
  const maximum = Math.max(step, Math.ceil(peak / step) * step);
  const slot = 800 / Math.max(1, days.length);
  const width = Math.min(48, slot * 0.68);
  return {
    maximum,
    ticks: Array.from({ length: maximum / step + 1 }, (_, index) => ({
      value: index * step,
      y: 176 - ((index * step) / maximum) * 168,
    })),
    bars: days.map((day, index) => ({
      day: day.day,
      count: day.human,
      x: slot * index + (slot - width) / 2,
      width,
      y: 176 - (day.human / maximum) * 168,
      height: (day.human / maximum) * 168,
      hitX: slot * index,
      hitWidth: slot,
    })),
  };
}

export type DayDetail = Readonly<
  { kind: "idle" } | { kind: "hover" | "pinned"; day: string }
>;
export type DayAction = Readonly<
  { kind: "enter" | "tap"; day: string } | { kind: "leave" | "clear" }
>;
export function dayDetail(detail: DayDetail, action: DayAction): DayDetail {
  switch (action.kind) {
    case "clear":
      return { kind: "idle" };
    case "leave":
      return detail.kind === "hover" ? { kind: "idle" } : detail;
    case "enter":
      return detail.kind === "pinned"
        ? detail
        : { kind: "hover", day: action.day };
    case "tap":
      return detail.kind === "pinned" && detail.day === action.day
        ? { kind: "idle" }
        : { kind: "pinned", day: action.day };
  }
}

export type RankedBar = CountGroup & Readonly<{ width: number }>;
export function rankedBars(rows: readonly CountGroup[]): readonly RankedBar[] {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return [...rows]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 20)
    .map((row) => ({ ...row, width: (row.count / maximum) * 100 }));
}
