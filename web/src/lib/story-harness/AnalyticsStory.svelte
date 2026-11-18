<script lang="ts">
  import { untrack } from "svelte";
  import Analytics from "../Analytics.svelte";
  import ManagementFrame from "../ManagementFrame.svelte";
  import { recentRange, selectedPeriod, validRange } from "../statistics";
  import {
    defaultRange,
    fixtureEventRows,
    fixtureStatistics,
  } from "./statistics-fixtures";
  import type {
    DateRange,
    EventsView,
    Resource,
    StatisticsTab,
    StatsView,
  } from "../view-models";
  let {
    scenario = "ready",
    initialTab = "overview",
  }: {
    scenario?: "ready" | "empty" | "pending" | "error";
    initialTab?: StatisticsTab;
  } = $props();
  const clock = new Date("2026-11-14T12:00:00Z");
  let range = $state<DateRange>({ ...defaultRange });
  let applied = $state<DateRange>({ ...defaultRange });
  let tab = $state<StatisticsTab>(untrack(() => initialTab));
  /** Both views observe the same applied range; no request is made. */
  function observe<T>(
    noun: string,
    empty: T,
    ready: (range: DateRange) => T,
  ): Resource<T> {
    return !validRange(applied)
      ? {
          kind: "error",
          reason: "validation",
          message: "Choose a valid inclusive date range.",
        }
      : scenario === "pending"
        ? { kind: "pending" }
        : scenario === "error"
          ? {
              kind: "error",
              message: `${noun} could not be loaded. Retry without changing the link.`,
            }
          : {
              kind: "ready",
              value: scenario === "empty" ? empty : ready(applied),
            };
  }
  let stats = $derived<Resource<StatsView>>(
    observe(
      "Statistics",
      {
        range: applied,
        human: 0,
        bot: 0,
        preview: 0,
        days: [],
        countries: [],
        devices: [],
        referrers: [],
      },
      fixtureStatistics,
    ),
  );
  let events = $derived<Resource<EventsView>>(
    observe("Events", { range: applied, rows: [] }, (range) => ({
      range: { ...range },
      rows: fixtureEventRows(range),
    })),
  );
</script>

<ManagementFrame
  identity={{
    label: "Field notes",
    address: "example.com/notes",
    destination: "https://example.org/notes",
  }}
>
  <Analytics
    view={{ label: "Field notes", tab, stats, events }}
    {range}
    period={selectedPeriod(range, clock)}
    onrange={(value) => (range = value)}
    onapply={() => (applied = { ...range })}
    onperiod={(days) => {
      range = recentRange(days, clock);
      applied = { ...range };
    }}
    ontab={(value) => (tab = value)}
  />
</ManagementFrame>
