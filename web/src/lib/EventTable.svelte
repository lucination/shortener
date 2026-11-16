<script lang="ts">
  import type { EventRow } from "./view-models";
  let { rows }: { rows: readonly EventRow[] } = $props();
</script>

{#if rows.length === 0}<div class="box-frame">
    No retained events in this range.
  </div>{:else}<div class="table-scroll">
    <table class="grid-table">
      <thead
        ><tr
          ><th>Time (UTC)</th><th>Link / class</th><th>IP</th><th>Location</th
          ><th>Browser / OS / device</th><th>Referrer / raw user agent</th></tr
        ></thead
      ><tbody
        >{#each rows as row (row.id)}<tr
            ><td>{row.at}</td><td
              >{row.link}<br /><span
                >{row.classification.toLowerCase() === "human"
                  ? "Click"
                  : row.classification}</span
              ></td
            ><td>{row.ip}</td><td>{row.city}<br />{row.country}</td><td
              >{row.browser}<br />{row.os} / {row.device}</td
            ><td
              ><div class="max-w-96 break">
                {row.referrer}<br /><span class="muted">{row.ua}</span>
              </div></td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>{/if}
