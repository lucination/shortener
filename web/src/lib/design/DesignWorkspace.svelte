<script lang="ts">
  import { DEFAULT_APP_NAME } from "../app-name";
  import type { Snippet } from "svelte";
  import type { LinkRow, LinkAction } from "../view-models";
  import {
    Copy,
    Pencil,
    Pause,
    Play,
    ChartNoAxesCombined,
    Plus,
    Search,
    Link,
    Upload,
  } from "@lucide/svelte";
  let {
    appName = DEFAULT_APP_NAME,
    direction,
    rows,
    visibleRows,
    search,
    feedback,
    onsearch,
    oncreate,
    onimport,
    onaction,
    form,
  }: {
    appName?: string;
    direction: "precision" | "paper" | "studio";
    rows: readonly LinkRow[];
    visibleRows: readonly LinkRow[];
    search: string;
    feedback: string;
    onsearch: (value: string) => void;
    oncreate: () => void;
    onimport: () => void;
    onaction: (
      action: LinkAction,
      id: number,
      anchor: HTMLButtonElement,
    ) => void;
    form: Snippet;
  } = $props();
  const actions = ["copy", "edit", "stats", "toggle"] as const;
</script>

<section class="design-language dl-workspace" data-direction={direction}>
  <header class="dl-appbar">
    <div class="dl-brand">
      <span class="dl-mark"><Link size={17} /></span>{appName}
    </div>
  </header>
  <div class="dl-content">
    <div class="dl-page-heading">
      <h2>Links</h2>
      <div class="dl-buttons">
        <button onclick={onimport}><Upload size={14} />Import / paste</button
        ><button class="dl-primary" onclick={oncreate}
          ><Plus size={15} />Create link</button
        >
      </div>
    </div>
    {@render form()}
    <div class="dl-list-panel">
      <div class="dl-list-toolbar">
        <label class="dl-search"
          ><Search size={15} /><input
            type="search"
            placeholder="Search links"
            value={search}
            oninput={(e) => onsearch(e.currentTarget.value)}
          /></label
        ><span
          >{search
            ? `${visibleRows.length} of ${rows.length} links`
            : `${rows.length} ${rows.length === 1 ? "link" : "links"}`}</span
        >
      </div>
      {#if feedback}<div class="dl-feedback">{feedback}</div>{/if}
      <div class="dl-table-scroll">
        <table class="dl-table">
          <thead
            ><tr
              ><th>Link / destination</th><th>Short address</th><th
                class="dl-number">Clicks</th
              ><th>Status</th><th colspan="4" class="dl-action-heading"
                >Actions</th
              ></tr
            ></thead
          ><tbody>
            {#each visibleRows as row (row.id)}<tr data-link-id={row.id}
                ><td class="dl-identity"
                  ><strong>{row.label}</strong><span title={row.destination}
                    >{row.destination}</span
                  ></td
                ><td><code>{row.address}</code></td><td class="dl-number"
                  >{row.clicks.toLocaleString("en-US")}</td
                ><td
                  ><span class="dl-status" class:dl-disabled={!row.enabled}
                    ><i></i>{row.enabled ? "Enabled" : "Disabled"}</span
                  ></td
                >
                {#each actions as action}<td class="dl-action"
                    ><button
                      class="dl-icon"
                      title={`${action === "toggle" ? (row.enabled ? "Disable" : "Enable") : action === "copy" ? "Show address for" : action === "edit" ? "Edit" : "Clicks for"} ${row.label}`}
                      onclick={(event) =>
                        onaction(action, row.id, event.currentTarget)}
                      >{#if action === "copy"}<Copy
                          size={15}
                        />{:else if action === "edit"}<Pencil
                          size={15}
                        />{:else if action === "stats"}<ChartNoAxesCombined
                          size={15}
                        />{:else if row.enabled}<Pause size={15} />{:else}<Play
                          size={15}
                        />{/if}</button
                    ></td
                  >{/each}
              </tr>{/each}
          </tbody>
        </table>
      </div>
      {#if visibleRows.length === 0}<div class="dl-empty">
          <strong>No matching links</strong>
          <p>Try a title, destination or short alias.</p>
          <button onclick={() => onsearch("")}>Clear search</button>
        </div>{/if}
    </div>
  </div>
</section>
