<script lang="ts">
  import type {
    LinkRow,
    CopyFeedback,
    Resource,
    LinkAction,
    BulkAction,
  } from "./view-models";
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
                class="frozen-identity">Link / destination</th
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
                ><td>{row.clicks.toLocaleString()}</td><td
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
    {#if copyFeedback.kind === "success" || copyFeedback.kind === "error"}
      {@const feedback = copyFeedback}
      {#if state.value.some((row) => row.id === feedback.id)}
        <div
          class="copy-feedback"
          class:copy-error={feedback.kind === "error"}
          data-copy-id={feedback.id}
        >
          {feedback.message}
        </div>
      {/if}
    {/if}
  {/if}
</section>
