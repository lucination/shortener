import type { DateRange, EventRow, StatsView } from "../view-models";
// Independent, deterministic response-shaped fixtures; no allocation of aggregates to days.
const makeSnapshot = (
  from: string,
  values: readonly number[],
  bot: number,
  preview: number,
): StatsView => {
  const human = values.reduce((sum, value) => sum + value, 0);
  const total = human + bot + preview;
  const split = (labels: readonly string[], shares: readonly number[]) => {
    let remaining = total;
    return labels.map((label, index) => {
      const count =
        index === labels.length - 1
          ? remaining
          : Math.floor(total * shares[index]);
      remaining -= count;
      return { label, count };
    });
  };
  return {
    range: { from, to: "2026-11-14" },
    human,
    bot,
    preview,
    days: values.map((human, i) => ({
      day: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400000)
        .toISOString()
        .slice(0, 10),
      human,
    })),
    countries: split(
      [
        "United States",
        "Germany",
        "United Kingdom",
        "India",
        "Canada",
        "Unknown",
      ],
      [0.43, 0.17, 0.14, 0.11, 0.09],
    ),
    devices: split(
      ["Desktop", "Mobile", "Tablet", "Unknown"],
      [0.56, 0.35, 0.05],
    ),
    referrers: split(
      [
        "Direct / unknown",
        "newsletter.example.org",
        "github.com",
        "example.org",
        "news.ycombinator.com",
      ],
      [0.38, 0.27, 0.17, 0.12],
    ),
  };
};
const week = [80, 146, 112, 294, 176, 245, 231];
const previousWeek = [140, 170, 156, 310, 246, 224, 230];
const firstFortnight = [
  65, 80, 72, 110, 91, 130, 84, 98, 126, 102, 144, 160, 188, 108,
];
export const snapshots: readonly StatsView[] = [
  makeSnapshot("2026-11-08", week, 82, 146),
  makeSnapshot("2026-11-01", [...previousWeek, ...week], 174, 286),
  makeSnapshot(
    "2026-10-18",
    [...firstFortnight, ...previousWeek, ...week],
    312,
    458,
  ),
];
export const defaultRange: DateRange = { from: "2026-10-18", to: "2026-11-14" };

// Deterministic illustrative events, not production observations. Each recorded
// event has a day and category identities, so arbitrary ranges filter real fixture
// observations rather than scale period-only totals into a daily series.
const source = snapshots[2];
const categoryAt = (rows: StatsView["countries"], index: number) => {
  for (const row of rows) {
    if (index < row.count) return row.label;
    index -= row.count;
  }
  return "Unknown";
};
const fixtureEvents: { day: string; kind: "human" | "bot" | "preview" }[] =
  source.days
    .flatMap((day) =>
      Array.from({ length: day.human }, () => ({
        day: day.day,
        kind: "human" as "human" | "bot" | "preview",
      })),
    )
    .concat(
      Array.from({ length: source.bot }, () => ({
        day: defaultRange.to,
        kind: "bot" as "human" | "bot" | "preview",
      })),
      Array.from({ length: source.preview }, () => ({
        day: defaultRange.to,
        kind: "preview" as "human" | "bot" | "preview",
      })),
    );
const observations = fixtureEvents.map((event, index) => ({
  ...event,
  countries: categoryAt(source.countries, index),
  devices: categoryAt(source.devices, index),
  referrers: categoryAt(source.referrers, index),
}));
/** Story display bound for the events view; the real API bounds a page at 1000 rows. */
export const fixtureEventLimit = 25;
const agents = [
  [
    "Firefox",
    "Linux",
    "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Firefox/120.0",
  ],
  [
    "Chrome",
    "macOS",
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0",
  ],
  ["Safari", "iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1"],
] as const;
/**
 * The newest retained fixture observations in `range` as event rows: the same
 * filtered events that produce the statistics, never a separate invented set.
 */
export function fixtureEventRows(range: DateRange): EventRow[] {
  return observations
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.day >= range.from && event.day <= range.to)
    .reverse()
    .slice(0, fixtureEventLimit)
    .map(({ event, index }) => {
      const [browser, os, ua] = agents[index % agents.length];
      const second = index % 86400;
      return {
        id: index + 1,
        at: `${event.day}T${new Date(second * 1000).toISOString().slice(11, 19)}Z`,
        link: "#1",
        ip: `192.0.2.${(index % 254) + 1}`,
        ua,
        referrer: event.referrers,
        country: event.countries,
        city: "Unknown",
        browser,
        os,
        device: event.devices,
        classification: event.kind,
      };
    });
}
export function fixtureStatistics(range: DateRange): StatsView {
  const events = observations.filter(
    (event) => event.day >= range.from && event.day <= range.to,
  );
  const count = (kind: string) =>
    events.filter((event) => event.kind === kind).length;
  const group = (key: "countries" | "devices" | "referrers") => {
    const counts = new Map<string, number>();
    for (const event of events)
      counts.set(event[key], (counts.get(event[key]) ?? 0) + 1);
    return [...counts].map(([label, count]) => ({ label, count }));
  };
  const days = source.days.filter(
    (day) => day.day >= range.from && day.day <= range.to,
  );
  return {
    range: { ...range },
    days,
    human: count("human"),
    bot: count("bot"),
    preview: count("preview"),
    countries: group("countries"),
    devices: group("devices"),
    referrers: group("referrers"),
  };
}
