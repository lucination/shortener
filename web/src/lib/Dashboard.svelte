<script lang="ts">
  import type {
    LinkRow,
    Resource,
    LinkAction,
    BulkAction,
  } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  import { bulkActionLabels } from "./view-models";
  import {
    Copy,
    Pencil,
    ChartNoAxesCombined,
    List,
    Pause,
    Play,
    Trash2,
    CalendarClock,
    Archive,
    Plus,
  } from "@lucide/svelte";
  let {
    state,
    mode = "manage",
    search = "",
    selected = [],
    onsearch = () => {},
    oncreate = () => {},
    onbulkcreate = () => {},
    onselect = () => {},
    onselectall = () => {},
    onaction = () => {},
    onbulk = () => {},
    onretry = () => {},
  }: {
    state: Resource<readonly LinkRow[]>;
    mode?: "manage" | "read-only";
    search?: string;
    selected?: readonly number[];
    onsearch?: (value: string) => void;
    oncreate?: () => void;
    onbulkcreate?: () => void;
    onselect?: (id: number) => void;
    onselectall?: (selected: boolean) => void;
    onaction?: (action: LinkAction, id: number) => void;
    onbulk?: (action: BulkAction) => void;
    onretry?: () => void;
  } = $props();
  const actions: readonly LinkAction[] = [
    "copy",
    "edit",
    "stats",
    "events",
    "toggle",
    "delete",
  ];
  const bulkActions: readonly BulkAction[] = [
    "enable",
    "disable",
    "delete",
    "expiration",
    "retention",
  ];
  const visibleRows = $derived(state.kind === "ready" ? state.value : []);
  const selectedVisible = $derived(
    visibleRows.filter((row) => selected.includes(row.id)).length,
  );
  const actionTitle = (action: LinkAction, enabled: boolean): string =>
    action === "copy"
      ? "Copy address"
      : action === "edit"
        ? "Edit link"
        : action === "stats"
          ? "View statistics"
          : action === "events"
            ? "View events"
            : action === "delete"
              ? "Delete link"
              : enabled
                ? "Disable link"
                : "Enable link";
</script>

<section class="stack">
  <div class="toolbar spread">
    <div>
      <h1>Links</h1>
    </div>
    {#if mode === "manage"}<div class="toolbar">
        <button onclick={onbulkcreate}>Import / paste</button><button
          class="btn-primary with-icon"
          onclick={oncreate}><Plus size={14} />Create link</button
        >
      </div>{/if}
  </div>
  <div class="toolbar spread">
    {#if mode === "manage"}<input
        class="grow"
        type="search"
        placeholder="Search links, destinations, aliases…"
        value={search}
        oninput={(event) => onsearch(event.currentTarget.value)}
      />{/if}<span
      >{state.kind === "ready"
        ? `${state.value.length} links`
        : "— links"}</span
    >
  </div>
  {#if mode === "manage" && selected.length > 0}<div class="box-frame toolbar">
      <strong>{selected.length} selected</strong
      >{#each bulkActions as action}<button
          class="icon-button"
          title={action === "expiration" || action === "retention"
            ? bulkActionLabels[action]
            : `${bulkActionLabels[action]} selected links`}
          onclick={() => onbulk(action)}
          >{#if action === "enable"}<Play
              size={16}
            />{:else if action === "disable"}<Pause
              size={16}
            />{:else if action === "delete"}<Trash2
              size={16}
            />{:else if action === "expiration"}<CalendarClock
              size={16}
            />{:else}<Archive size={16} />{/if}</button
        >{/each}
    </div>{/if}
  <ResourceStatus {state} {onretry} />
  {#if state.kind === "ready"}
    {#if state.value.length === 0}<div class="box-frame stack">
        <h2>No matching links</h2>
        {#if mode === "manage"}<p>
            Create your first link or try another search.
          </p>
          <button onclick={oncreate}>Create link</button>{/if}
      </div>
    {:else}<div class="table-scroll">
        <table class="grid-table">
          <thead
            ><tr
              >{#if mode === "manage"}<th class="selection-cell"
                  ><input
                    type="checkbox"
                    title="Select all visible links"
                    checked={visibleRows.length > 0 &&
                      selectedVisible === visibleRows.length}
                    indeterminate={selectedVisible > 0 &&
                      selectedVisible < visibleRows.length}
                    onchange={(event) =>
                      onselectall(event.currentTarget.checked)}
                  /></th
                >{/if}<th class="frozen-identity">Link / destination</th><th
                >Short address</th
              ><th class="compact-cell">Clicks</th><th class="compact-cell"
                >Status</th
              >{#if mode === "manage"}<th colspan="6">Actions</th>{/if}</tr
            ></thead
          ><tbody>
            {#each state.value as row (row.id)}<tr
                >{#if mode === "manage"}<td class="selection-cell"
                    ><input
                      type="checkbox"
                      title={`Select ${row.label}`}
                      checked={selected.includes(row.id)}
                      onchange={() => onselect(row.id)}
                    /></td
                  >{/if}<td class="frozen-identity"
                  ><strong title={row.label}>{row.label}</strong>
                  <div class="muted max-w-72 truncate" title={row.destination}>
                    {row.destination}
                  </div></td
                ><td
                  >{#if mode === "manage"}<button
                      class="copy-address"
                      title="Copy short address"
                      onclick={() => onaction("copy", row.id)}
                      ><code>{row.address}</code></button
                    >{:else}<code>{row.address}</code>{/if}</td
                ><td class="compact-cell">{row.clicks.toLocaleString()}</td><td
                  class="compact-cell"
                  ><span class="link-status"
                    ><span class:off={!row.enabled} class="status-dot"
                    ></span><span>{row.enabled ? "Enabled" : "Disabled"}</span
                    ></span
                  ></td
                >{#if mode === "manage"}{#each actions as action}<td
                      class="action-cell"
                      ><button
                        class="icon-button"
                        data-action={action}
                        title={actionTitle(action, row.enabled)}
                        onclick={() => onaction(action, row.id)}
                        >{#if action === "copy"}<Copy
                            size={16}
                          />{:else if action === "edit"}<Pencil
                            size={16}
                          />{:else if action === "stats"}<ChartNoAxesCombined
                            size={16}
                          />{:else if action === "events"}<List
                            size={16}
                          />{:else if action === "delete"}<Trash2
                            size={16}
                          />{:else if row.enabled}<Pause
                            size={16}
                          />{:else}<Play size={16} />{/if}</button
                      ></td
                    >{/each}{/if}</tr
              >{/each}
          </tbody>
        </table>
      </div>{/if}
  {/if}
</section>
