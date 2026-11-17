<script lang="ts">
  import type {
    CountGroup,
    DateRange,
    Resource,
    StatsView,
  } from "./view-models";
  import {
    type DayDetail,
    type DayAction,
    dailyChart,
    rankedBars,
  } from "./statistics-chart";
  import { completeDays } from "./statistics";
  import "./statistics-overview.css";
  let {
    state,
    range,
    detail,
    onday,
    onrange,
    onapply,
    onback,
    onperiod,
    period = "custom",
    label,
  }: {
    state: Resource<StatsView>;
    range: DateRange;
    label: string;
    detail: DayDetail;
    onday: (action: DayAction) => void;
    onrange: (range: DateRange) => void;
    onapply: () => void;
    onback: () => void;
    onperiod?: (days: number) => void;
    period?: string;
  } = $props();
  const format = (value: number) => value.toLocaleString("en-US");
  const metrics = [
    { key: "human", label: "Clicks" },
    { key: "bot", label: "Bot redirects" },
    { key: "preview", label: "Previews" },
  ] as const;
  const groups = [
    { key: "countries", label: "Countries" },
    { key: "devices", label: "Devices" },
    { key: "referrers", label: "Referrers" },
  ] as const;
</script>

{#snippet totals(stats: StatsView)}
  <div class="so-totals">
    {#each metrics as item}<div class="so-total">
        <span>{item.label}</span><strong
          data-testid={item.key === "human" ? "human-total" : undefined}
          >{format(stats[item.key])}</strong
        >
      </div>{/each}
  </div>
{/snippet}

{#snippet chart(stats: StatsView)}
  {@const days = completeDays(stats.days, stats.range ?? range)}
  {@const plot = dailyChart(days)}
  <section class="so-chart-panel">
    <div class="so-section-head"><h2>Daily activity</h2></div>
    {#if !stats.days.length}<div class="so-chart-empty">
        <p>No redirects in this date range.</p>
      </div>
    {:else}
      {@const selected =
        detail.kind === "idle"
          ? undefined
          : plot.bars.find((bar) => bar.day === detail.day)}
      <div class="so-detail-row">
        {#if selected}<strong data-testid="day-detail"
            >{`${selected.day} · ${format(selected.count)} ${selected.count === 1 ? "click" : "clicks"}`}
            <small>UTC</small></strong
          >
          {#if detail.kind === "pinned"}<button
              onclick={() => onday({ kind: "clear" })}>Clear day</button
            >{/if}
        {:else}<span>clicks/day</span><small>Hover or tap a day</small>{/if}
      </div>
      <div class="so-plot">
        <div class="so-y-axis">
          {#each plot.ticks as tick}<span
              data-tick={tick.value}
              style:top={`${(tick.y / 184) * 100}%`}>{format(tick.value)}</span
            >{/each}
        </div>
        <svg class="so-chart" viewBox="0 0 800 184" preserveAspectRatio="none">
          {#each plot.ticks as tick}<line
              x1="0"
              x2="800"
              y1={tick.y}
              y2={tick.y}
              class="so-gridline"
            />{/each}
          {#each plot.bars as bar}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <g
              data-day={bar.day}
              class:so-selected={selected?.day === bar.day}
              onmouseenter={() => onday({ kind: "enter", day: bar.day })}
              onmouseleave={() => onday({ kind: "leave" })}
              onclick={() => onday({ kind: "tap", day: bar.day })}
            >
              <rect
                class="so-hit"
                x={bar.hitX}
                y="0"
                width={bar.hitWidth}
                height="184"
              />
              <rect
                class="so-bar"
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx="2"
              />
              <title>{bar.day}: {format(bar.count)} clicks</title>
            </g>{/each}
        </svg>
      </div>
      <div class="so-chart-label so-x-axis">
        <span>{days[0]?.day}</span>{#if days.length > 1}<span
            >{days.at(-1)?.day}</span
          >{/if}
      </div>
    {/if}
  </section>
{/snippet}

{#snippet ranked(rows: readonly CountGroup[], title: string)}
  <section class="so-ranking">
    <div class="so-section-head">
      <h2>{title}</h2>
      <small>Events</small>
    </div>
    {#if !rows.length}<p class="so-empty">No observations</p>{/if}
    {#each rankedBars(rows) as row, index}<div class="so-rank-row">
        <div class="so-rank-title">
          <span
            ><small>{String(index + 1).padStart(2, "0")}</small>
            {row.label}</span
          ><strong>{format(row.count)}</strong>
        </div>
        <div class="so-track"><i style:width={`${row.width}%`}></i></div>
      </div>{/each}
  </section>
{/snippet}

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
  {#if state.kind === "pending"}<div class="so-state">Loading statistics…</div>
  {:else if state.kind === "error"}<div class="so-state so-error">
      <p>{state.message}</p>
      <button onclick={onapply}>Retry dates</button>
    </div>
  {:else}{@const stats = state.value}
    <p class="so-observed">
      {(stats.range ?? range).from} — {(stats.range ?? range).to} · UTC
    </p>
    {@render totals(stats)}{@render chart(stats)}
    <div class="so-all-breakdowns">
      {#each groups as group}{@render ranked(
          stats[group.key],
          group.label,
        )}{/each}
    </div>
  {/if}
</section>
