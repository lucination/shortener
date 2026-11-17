<script lang="ts">
  import Analytics from "../Analytics.svelte";
  import ManagementFrame from "../ManagementFrame.svelte";
  import { recentRange, selectedPeriod } from "../statistics";
  import { defaultRange, fixtureStatistics } from "./statistics-fixtures";
  import type { DateRange, Resource, StatsView } from "../view-models";
  let {
    scenario = "ready",
  }: { scenario?: "ready" | "empty" | "pending" | "error" } = $props();
  const clock = new Date("2026-11-14T12:00:00Z");
  let range = $state<DateRange>({ ...defaultRange });
  let applied = $state<DateRange>({ ...defaultRange });
  let resource = $derived<Resource<StatsView>>(
    !/^\d{4}-\d{2}-\d{2}$/.test(applied.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(applied.to) ||
      applied.from > applied.to
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
              message:
                "Statistics could not be loaded. Retry without changing the link.",
            }
          : {
              kind: "ready",
              value:
                scenario === "empty"
                  ? {
                      range: applied,
                      human: 0,
                      bot: 0,
                      preview: 0,
                      days: [],
                      countries: [],
                      devices: [],
                      referrers: [],
                    }
                  : fixtureStatistics(applied),
            },
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
    view={{ kind: "stats", label: "Field notes", state: resource }}
    {range}
    period={selectedPeriod(range, clock)}
    onrange={(value) => (range = value)}
    onapply={() => (applied = { ...range })}
    onperiod={(days) => {
      range = recentRange(days, clock);
      applied = { ...range };
    }}
  />
</ManagementFrame>
