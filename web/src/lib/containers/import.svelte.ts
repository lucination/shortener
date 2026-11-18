import type { Api } from "../adapters/api";
import { parseDraft } from "../adapters/draft";
import { parseBulk, type ImportedRow } from "../bulk";
import type { BulkResult, LinkInput } from "../generated";
import { emptyDraft, type Outcome } from "../view-models";
import type { Generation } from "./generation";
import type { PageOutcome } from "./outcome.svelte";

export const importLimitBytes = 1024 * 1024;

/** Valid requests for every parsed row, or undefined if any row is unusable. */
export function importItems(
  rows: readonly ImportedRow[],
): LinkInput[] | undefined {
  if (!rows.length || rows.some((row) => row.kind === "invalid")) return;
  const items = rows.flatMap((row) => {
    if (row.kind !== "valid") return [];
    const parsed = parseDraft({
      ...emptyDraft,
      destination: row.destination,
      alias: row.alias,
    });
    return parsed.kind === "valid" ? [parsed.input] : [];
  });
  return items.length === rows.length ? items : undefined;
}

/**
 * Reduces a bulk-create response to the retry text (only failed source rows,
 * re-quoted as CSV) and inline feedback naming original physical rows.
 */
export function importSummary(
  rows: readonly ImportedRow[],
  results: readonly BulkResult[],
): { text: string; outcome: Outcome } {
  const failed = results.filter((row) => row.status === "failed");
  const created = results.filter((row) => row.status === "created");
  const text = failed
    .flatMap((row) => {
      const source = rows[row.index];
      return source?.kind === "valid"
        ? [
            [source.destination, source.alias]
              .map((cell) => `"${cell.replaceAll('"', '""')}"`)
              .join(","),
          ]
        : [];
    })
    .join("\n");
  return {
    text,
    outcome: failed.length
      ? {
          kind: "error",
          message: results
            .map(
              (row) =>
                `Row ${rows[row.index]?.row ?? row.index + 1}: ${row.status === "created" ? "created" : row.error.message}`,
            )
            .join(" · "),
        }
      : {
          kind: "success",
          message: `Created ${created.length} links. Return to links to manage them.`,
        },
  };
}

/** CSV/paste bulk import form. Results stay inline beside the form. */
export class ImportController {
  text = $state("");
  readonly #api: Api;
  readonly #generation: Generation;
  readonly #outcome: PageOutcome;
  readonly #active: () => boolean;
  constructor(deps: {
    api: Api;
    generation: Generation;
    outcome: PageOutcome;
    active: () => boolean;
  }) {
    this.#api = deps.api;
    this.#generation = deps.generation;
    this.#outcome = deps.outcome;
    this.#active = deps.active;
  }
  get rows(): readonly ImportedRow[] {
    return parseBulk(this.text);
  }
  open() {
    this.text = "";
  }
  setText(text: string) {
    if (this.#active()) this.text = text;
  }
  async submit() {
    if (!this.#active() || this.#outcome.pending) return;
    const request = this.#generation.current;
    const rows = this.rows;
    const items = importItems(rows);
    if (!items) return;
    this.#outcome.begin();
    const result = await this.#api.bulk({ items });
    if (!this.#generation.owns(request)) return;
    if (result.kind === "failed") {
      this.#outcome.notify(result, "");
      return;
    }
    const summary = importSummary(rows, result.value.items);
    this.text = summary.text;
    this.#outcome.value = summary.outcome;
  }
  /** Reading a file supersedes any in-flight import or earlier read. */
  async readFile(file: File) {
    if (!this.#active()) return;
    const request = this.#generation.advance();
    this.#outcome.reset();
    if (file.size > importLimitBytes) {
      this.#outcome.fail("CSV exceeds the 1 MiB browser import limit.");
      return;
    }
    try {
      const text = await file.text();
      if (!this.#generation.owns(request)) return;
      if (this.#active()) this.text = text;
    } catch {
      if (!this.#generation.owns(request)) return;
      this.#outcome.fail("Could not read the selected file.");
    }
  }
}
