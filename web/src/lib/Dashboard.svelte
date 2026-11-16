<script lang="ts">
  import type {
    LinkRow,
    CopyFeedback,
    Resource,
    LinkAction,
    BulkAction,
  } from "./view-models";
  import { anchorFeedback } from "./presentation/anchor-feedback";
  import ResourceStatus from "./ResourceStatus.svelte";
  import {
    Copy,
    Pencil,
    ChartNoAxesCombined,
    List,
    Pause,
    Play,
    Trash2,
  } from "@lucide/svelte";
  let {
    state,
    copyFeedback = { kind: "idle" },
    mode = "manage",
    search = "",
    selected = [],
    onsearch = () => {},
    oncreate = () => {},
    onbulkcreate = () => {},
    onselect = () => {},
    onaction = () => {},
    onbulk = () => {},
    onretry = () => {},
  }: {
    state: Resource<readonly LinkRow[]>;
    copyFeedback?: CopyFeedback;
    mode?: "manage" | "read-only";
    search?: string;
    selected?: readonly number[];
    onsearch?: (value: string) => void;
    oncreate?: () => void;
    onbulkcreate?: () => void;
    onselect?: (id: number) => void;
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
          class="btn-primary"
          onclick={oncreate}>+ Create link</button
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
      >{#each bulkActions as action}<button onclick={() => onbulk(action)}
          >{action}</button
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
              >{#if mode === "manage"}<th>Select</th>{/if}<th
                >Link / destination</th
              ><th>Short address</th><th>Clicks</th><th>Status</th
              >{#if mode === "manage"}<th colspan="6">Actions</th>{/if}</tr
            ></thead
          ><tbody>
            {#each state.value as row (row.id)}<tr
                >{#if mode === "manage"}<td
                    ><input
                      type="checkbox"
                      title={`Select ${row.label}`}
                      checked={selected.includes(row.id)}
                      onchange={() => onselect(row.id)}
                    /></td
                  >{/if}<td
                  ><strong title={row.label}>{row.label}</strong>
                  <div class="muted max-w-72 truncate" title={row.destination}>
                    {row.destination}
                  </div></td
                ><td><code>{row.address}</code></td><td
                  >{row.clicks.toLocaleString()}</td
                ><td
                  ><span class:off={!row.enabled} class="status-dot"
                  ></span>{row.enabled ? "Enabled" : "Disabled"}</td
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
                      >{#if action === "copy" && (copyFeedback.kind === "success" || copyFeedback.kind === "error") && copyFeedback.id === row.id}<span
                          class="copy-feedback"
                          class:copy-error={copyFeedback.kind === "error"}
                          use:anchorFeedback={{
                            rows: state.value,
                            copyFeedback,
                          }}>{copyFeedback.message}</span
                        >{/if}</td
                    >{/each}{/if}</tr
              >{/each}
          </tbody>
        </table>
      </div>{/if}
  {/if}
</section>

<style>
  .copy-feedback {
    position: fixed;
    z-index: 50;
    width: max-content;
    max-width: min(280px, calc(100vw - 16px));
    padding: 6px 10px;
    border: 1px solid var(--dl-line);
    border-radius: 6px;
    background: var(--dl-panel);
    color: var(--dl-text);
    font-size: 12px;
    line-height: 1.5;
    box-shadow: 0 10px 24px rgb(0 0 0 / 20%);
    pointer-events: none;
    white-space: normal;
  }
  .copy-error {
    color: var(--dl-danger);
  }
</style>
