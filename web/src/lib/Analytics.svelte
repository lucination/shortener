<script lang="ts">
  import type { AnalyticsView, DateRange, StatisticsTab } from "./view-models";
  import EventTable from "./EventTable.svelte";
  import StatisticsOverview from "./StatisticsOverview.svelte";
  import { dayDetail, type DayDetail } from "./statistics-chart";
  import "./statistics-overview.css";
  let {
    view,
    range,
    onrange = () => {},
    onapply = () => {},
    onback = () => {},
    onperiod,
    period = "custom",
    ontab = () => {},
    onretryevents,
  }: {
    view: AnalyticsView;
    range: DateRange;
    onrange?: (range: DateRange) => void;
    onapply?: () => void;
    onback?: () => void;
    onperiod?: (days: number) => void;
    period?: string;
    ontab?: (tab: StatisticsTab) => void;
    onretryevents?: () => void;
  } = $props();
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "events", label: "Events" },
  ] as const;
  let detail = $state<DayDetail>({ kind: "idle" });
  // The observation, not an unsubmitted date draft, the selected view or a
  // completed events request, owns chart interaction.
  const observation = $derived(view.stats);
  const label = $derived(view.label);
  $effect(() => {
    observation;
    label;
    detail = { kind: "idle" };
  });
  /** WAI-ARIA tabs: arrows/Home/End select and focus another tab. */
  function keyed(event: KeyboardEvent, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    if (tabs[next].key !== view.tab) ontab(tabs[next].key);
    const list = (event.currentTarget as HTMLElement).parentElement;
    list?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }
</script>

<section class="statistics-overview">
  <header class="so-heading">
    <div>
      <h1>Link statistics</h1>
      <p class="so-link-name">{label}</p>
    </div>
    <button onclick={onback}>Back to links</button>
  </header>
  <div class="so-datebar">
    {#if onperiod}<label
        >Period<select
          value={period}
          onchange={(e) => onperiod?.(Number(e.currentTarget.value))}
          ><option value="28">28 days</option><option value="14">14 days</option
          ><option value="7">7 days</option><option value="custom" disabled
            >Custom dates</option
          ></select
        ></label
      >{/if}
    <label
      >From<input
        type="date"
        value={range.from}
        oninput={(e) => onrange({ ...range, from: e.currentTarget.value })}
      /></label
    >
    <label
      >To<input
        type="date"
        value={range.to}
        oninput={(e) => onrange({ ...range, to: e.currentTarget.value })}
      /></label
    ><button class="so-apply btn-primary" onclick={onapply}>Apply dates</button>
  </div>
  <p class="so-scope">
    Dates are inclusive, in UTC. Clicks count human redirects, not unique
    visitors.
  </p>
  <div class="so-tabs" role="tablist" aria-label="Statistics views">
    {#each tabs as item, index}<button
        role="tab"
        id={`statistics-tab-${item.key}`}
        aria-selected={view.tab === item.key}
        aria-controls={`statistics-panel-${item.key}`}
        tabindex={view.tab === item.key ? 0 : -1}
        onclick={() => {
          if (view.tab !== item.key) ontab(item.key);
        }}
        onkeydown={(event) => keyed(event, index)}>{item.label}</button
      >{/each}
  </div>
  <div
    class="so-panel"
    role="tabpanel"
    id={`statistics-panel-${view.tab}`}
    aria-labelledby={`statistics-tab-${view.tab}`}
  >
    {#if view.tab === "overview"}<StatisticsOverview
        state={view.stats}
        {range}
        {detail}
        onday={(action) => (detail = dayDetail(detail, action))}
        onretry={onapply}
      />
    {:else if view.events.kind === "pending"}<div class="so-state">
        Loading events…
      </div>
    {:else if view.events.kind === "error"}<div class="so-state so-error">
        <p>{view.events.message}</p>
        <button onclick={onretryevents ?? onapply}>Retry events</button>
      </div>
    {:else}<p class="so-observed" data-testid="events-observed">
        {view.events.value.range.from} — {view.events.value.range.to} · UTC
      </p>
      <EventTable rows={view.events.value.rows} />{/if}
  </div>
</section>
