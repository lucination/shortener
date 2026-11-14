<script lang="ts">
  import type { AnalyticsView, DateRange } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  import EventTable from "./EventTable.svelte";
  let {
    view,
    range,
    onrange = () => {},
    onapply = () => {},
    onback = () => {},
  }: {
    view: AnalyticsView;
    range: DateRange;
    onrange?: (range: DateRange) => void;
    onapply?: () => void;
    onback?: () => void;
  } = $props();
  const points = (days: readonly { human: number }[]) =>
    days
      .map(
        (day, index) =>
          `${30 + index * (740 / Math.max(1, days.length - 1))},${175 - (day.human / Math.max(1, ...days.map((d) => d.human))) * 140}`,
      )
      .join(" ");
</script>

<section class="stack">
  <div class="toolbar spread">
    <div>
      <p class="muted">WORKSPACE / {view.label}</p>
      <h1>{view.kind === "stats" ? "Link statistics" : "Click events"}</h1>
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
  <ResourceStatus state={view.state} onretry={onapply} />
  {#if view.kind === "stats" && view.state.kind === "ready"}{@const stats =
      view.state.value}
    <div class="metric-grid">
      <div>
        <div class="muted">Human redirects</div>
        <div class="metric-value">{stats.human.toLocaleString()}</div>
      </div>
      <div>
        <div class="muted">Bot redirects</div>
        <div class="metric-value">{stats.bot.toLocaleString()}</div>
      </div>
      <div>
        <div class="muted">Previews</div>
        <div class="metric-value">{stats.preview.toLocaleString()}</div>
      </div>
      <div>
        <div class="muted">Period</div>
        <div>Daily UTC</div>
        <p class="muted">Inclusive dates</p>
      </div>
    </div>
    <div class="box-frame">
      <h2>Human redirects / day</h2>
      {#if stats.days.length}<svg
          class="chart"
          viewBox="0 0 800 210"
          preserveAspectRatio="none"
          ><line
            x1="30"
            x2="770"
            y1="175"
            y2="175"
            stroke="currentColor"
            stroke-width="2"
          /><line
            x1="30"
            x2="30"
            y1="20"
            y2="175"
            stroke="currentColor"
            stroke-width="2"
          /><polyline
            points={points(stats.days)}
            fill="none"
            stroke="currentColor"
            stroke-width="3"
          />{#each stats.days as day, index}<circle
              cx={30 + index * (740 / Math.max(1, stats.days.length - 1))}
              cy={175 -
                (day.human / Math.max(1, ...stats.days.map((d) => d.human))) *
                  140}
              r="4"
              fill="currentColor"
              ><title>{day.day}: {day.human} human redirects</title></circle
            >{/each}</svg
        >
        <div class="toolbar spread muted">
          <span>{stats.days[0]?.day}</span><span
            >{stats.days[stats.days.length - 1]?.day}</span
          >
        </div>{:else}<p>No redirects in this date range.</p>{/if}
    </div>
    <div class="form-grid">
      {#each [{ title: "Countries", rows: stats.countries }, { title: "Devices", rows: stats.devices }, { title: "Referrers", rows: stats.referrers }] as group}<div
          class="box-frame stack"
        >
          <h2>{group.title}</h2>
          {#if !group.rows.length}<p class="muted">
              No observations
            </p>{/if}{#each group.rows as row}<div>
              <div class="toolbar spread">
                <span class="break">{row.label}</span><strong
                  >{row.count}</strong
                >
              </div>
              <meter
                class="w-full"
                min="0"
                max={Math.max(1, ...group.rows.map((item) => item.count))}
                value={row.count}>{row.count}</meter
              >
            </div>{/each}
        </div>{/each}
    </div>
    <p class="muted">
      Daily unique counts are approximate. They must not be summed as multi-day
      distinct visitors. Unknown geography is not inferred.
    </p>
  {:else if view.kind === "events" && view.state.kind === "ready"}<EventTable
      rows={view.state.value}
    />{/if}
</section>
