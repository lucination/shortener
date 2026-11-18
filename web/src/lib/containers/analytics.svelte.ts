import type { Api } from "../adapters/api";
import { eventRow, statsView } from "../mappings";
import { resultResource } from "../resource";
import type { AnalyticsView, DateRange } from "../view-models";
import type { Generation } from "./generation";

const day = /^\d{4}-\d{2}-\d{2}$/;
export const validRange = (range: DateRange): boolean =>
  day.test(range.from) && day.test(range.to) && range.from <= range.to;

/** The last seven UTC days, inclusive. */
export function initialRange(now = new Date()): DateRange {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 6);
  return {
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

/**
 * In-app statistics/events modal: the observed view for one link and the
 * draft date range. A response publishes only for its own generation.
 */
export class AnalyticsController {
  id = $state(0);
  view: AnalyticsView = $state({
    kind: "events",
    label: "",
    state: { kind: "pending" },
  });
  range: DateRange = $state(initialRange());
  readonly #api: Api;
  readonly #generation: Generation;
  constructor(deps: { api: Api; generation: Generation }) {
    this.#api = deps.api;
    this.#generation = deps.generation;
  }
  setRange(range: DateRange) {
    this.range = range;
  }
  /** Withdraws the previous observation and loads `range` for `id`. */
  async load(
    id: number,
    label: string,
    kind: "stats" | "events",
    range: DateRange,
  ) {
    this.id = id;
    this.range = range;
    this.view = { kind, label, state: { kind: "pending" } };
    const request = this.#generation.current;
    if (kind === "stats") {
      const result = await this.#api.stats(id, range);
      if (!this.#generation.owns(request)) return;
      this.id = id;
      this.range = range;
      this.view = { kind, label, state: resultResource(result, statsView) };
    } else {
      const result = await this.#api.events(id, range);
      if (!this.#generation.owns(request)) return;
      this.id = id;
      this.range = range;
      this.view = {
        kind,
        label,
        state: resultResource(result, (value) => value.items.map(eventRow)),
      };
    }
  }
}
