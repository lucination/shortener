import type { DateRange, StatsView } from "./view-models";
export function completeDays(
  days: StatsView["days"],
  range: DateRange,
): StatsView["days"] {
  const start = Date.parse(`${range.from}T00:00:00Z`),
    end = Date.parse(`${range.to}T00:00:00Z`);
  const count = Math.round((end - start) / 86400000) + 1;
  if (!Number.isFinite(count) || count < 1 || count > 3661) return [];
  const observed = new Map(days.map((day) => [day.day, day.human]));
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(start + index * 86400000).toISOString().slice(0, 10);
    return { day, human: observed.get(day) ?? 0 };
  });
}
