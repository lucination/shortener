<script lang="ts">
  import type { ImportedRow } from "./bulk";
  import type { Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    text,
    rows,
    outcome,
    onchange = () => {},
    onfile = () => {},
    onsubmit = () => {},
    oncancel = () => {},
  }: {
    text: string;
    rows: readonly ImportedRow[];
    outcome: Outcome;
    onchange?: (text: string) => void;
    onfile?: (file: File) => void;
    onsubmit?: () => void;
    oncancel?: () => void;
  } = $props();
</script>

<section class="stack">
  <h1>Import links</h1>
  <p>
    Paste one URL per line, or CSV with <code>destination,alias</code>. Review
    every row before creating links.
  </p>
  <label class="field"
    >CSV file<input
      type="file"
      accept=".csv,text/csv"
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) onfile(file);
      }}
    /></label
  >
  <label class="field"
    >URLs / CSV<textarea
      value={text}
      oninput={(event) => onchange(event.currentTarget.value)}
      placeholder="destination,alias&#10;https://example.org,example"
    ></textarea></label
  >
  <div class="table-scroll">
    <table class="grid-table">
      <thead
        ><tr><th>Row</th><th>Destination</th><th>Alias / result</th></tr></thead
      ><tbody
        >{#each rows as row}<tr
            ><td>{row.row}</td>{#if row.kind === "valid"}<td
                >{row.destination}</td
              ><td>{row.alias || "Generated"}</td>{:else}<td
                colspan="2"
                class="error">{row.message}</td
              >{/if}</tr
          >{/each}</tbody
      >
    </table>
  </div>
  <ResourceStatus state={outcome} />
  <div class="toolbar">
    <button
      class="btn-primary"
      disabled={!rows.length ||
        rows.some((row) => row.kind === "invalid") ||
        outcome.kind === "pending"}
      onclick={onsubmit}>Create {rows.length} links</button
    ><button onclick={oncancel}>Cancel</button>
  </div>
</section>
