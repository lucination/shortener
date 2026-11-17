<script lang="ts">
  import type { AnalyticsView, DateRange } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  import EventTable from "./EventTable.svelte";
  import StatisticsOverview from "./StatisticsOverview.svelte";
  import { dayDetail, type DayDetail } from "./statistics-chart";
  let {
    view,
    range,
    onrange = () => {},
    onapply = () => {},
    onback = () => {},
    onperiod,
    period = "custom",
  }: {
    view: AnalyticsView;
    range: DateRange;
    onrange?: (range: DateRange) => void;
    onapply?: () => void;
    onback?: () => void;
    onperiod?: (days: number) => void;
    period?: string;
  } = $props();
  let detail = $state<DayDetail>({ kind: "idle" });
  // The observation, not an unsubmitted date draft, owns chart interaction.
  $effect(() => {
    view.state;
    view.label;
    detail = { kind: "idle" };
  });
</script>

{#if view.kind === "stats"}
  <StatisticsOverview
    state={view.state}
    {range}
    label={view.label}
    {detail}
    onday={(action) => (detail = dayDetail(detail, action))}
    {onrange}
    {onapply}
    {onback}
    {onperiod}
    {period}
  />
{:else}
  <section class="stack">
    <div class="toolbar spread">
      <div>
        <h1>Click events</h1>
        <p class="muted break">{view.label}</p>
      </div>
      <button onclick={onback}>Back to links</button>
    </div>
    <div class="toolbar date-toolbar">
      <label class="field"
        >From<input
          type="date"
          value={range.from}
          oninput={(event) =>
            onrange({ ...range, from: event.currentTarget.value })}
        /></label
      ><label class="field"
        >To<input
          type="date"
          value={range.to}
          oninput={(event) =>
            onrange({ ...range, to: event.currentTarget.value })}
        /></label
      ><button onclick={onapply}>Apply dates</button>
    </div>
    <p class="muted">
      Dates are inclusive, in UTC. Clicks count human redirects, not unique
      visitors.
    </p>
    <ResourceStatus state={view.state} onretry={onapply} />
    {#if view.kind === "events" && view.state.kind === "ready"}<EventTable
        rows={view.state.value}
      />{/if}
  </section>
{/if}
