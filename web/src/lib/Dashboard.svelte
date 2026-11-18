<script lang="ts">
  import type {
    LinkRow,
    Resource,
    LinkAction,
    BulkAction,
  } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  import RowMenu, { type RowMenuItem } from "./presentation/RowMenu.svelte";
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
    Hourglass,
    Plus,
    X,
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
  // Statistics and Edit stay visible; the rest live in each row's More actions menu.
  const primaryActions = [
    {
      action: "stats",
      label: "Statistics",
      name: "View statistics",
      icon: ChartNoAxesCombined,
    },
    { action: "edit", label: "Edit", name: "Edit link", icon: Pencil },
  ] as const;
  const menuItems = (enabled: boolean): readonly RowMenuItem[] => [
    { id: "copy", label: "Copy address", icon: Copy },
    { id: "events", label: "View events", icon: List },
    {
      id: "toggle",
      label: enabled ? "Disable link" : "Enable link",
      icon: enabled ? Pause : Play,
    },
    {
      id: "delete",
      label: "Delete link",
      icon: Trash2,
      tone: "danger",
      separated: true,
    },
  ];
  const linkActions: readonly string[] = [
    "copy",
    "edit",
    "stats",
    "events",
    "toggle",
    "delete",
  ] satisfies readonly LinkAction[];
  const isLinkAction = (id: string): id is LinkAction =>
    linkActions.includes(id);
  // Delete is last and set apart from the reversible bulk actions.
  const bulkActions: readonly BulkAction[] = [
    "enable",
    "disable",
    "expiration",
    "retention",
    "delete",
  ];
  const bulkName = (action: BulkAction): string =>
    action === "expiration" || action === "retention"
      ? bulkActionLabels[action]
      : `${bulkActionLabels[action]} selected links`;
  const visibleRows = $derived(state.kind === "ready" ? state.value : []);
  const selectedVisible = $derived(
    visibleRows.filter((row) => selected.includes(row.id)).length,
  );
  // Rows arrive filtered by `search`, so no rows with an empty query means no links at all.
  const query = $derived(search.trim());
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
        aria-label="Search links"
        placeholder="Search links, destinations, aliases…"
        value={search}
        oninput={(event) => onsearch(event.currentTarget.value)}
      />{/if}<span
      >{state.kind === "ready"
        ? `${state.value.length} links`
        : "— links"}</span
    >
  </div>
  {#if mode === "manage" && selected.length > 0}<div
      class="box-frame toolbar bulk-bar"
      role="toolbar"
      aria-label="Bulk actions"
    >
      <strong>{selected.length} selected</strong
      >{#each bulkActions as action}<button
          class="with-icon"
          class:btn-danger={action === "delete"}
          aria-label={bulkName(action)}
          title={bulkName(action)}
          data-bulk-action={action}
          onclick={() => onbulk(action)}
          >{#if action === "enable"}<Play
              size={14}
            />{:else if action === "disable"}<Pause
              size={14}
            />{:else if action === "delete"}<Trash2
              size={14}
            />{:else if action === "expiration"}<CalendarClock
              size={14}
            />{:else}<Hourglass size={14} />{/if}{bulkActionLabels[
            action
          ]}</button
        >{/each}
    </div>{/if}
  <ResourceStatus {state} {onretry} />
  {#if state.kind === "ready"}
    {#if state.value.length === 0}
      {#if mode === "read-only"}<div class="box-frame empty-state">
          <h2>No links</h2>
          <p class="muted">There are no links to show.</p>
        </div>
      {:else if query === ""}<div class="box-frame empty-state first-run">
          <h2>Create your first short link</h2>
          <p class="muted">
            A short link is a compact address that sends visitors to a longer
            destination. You can edit, pause and measure it at any time.
          </p>
          <div class="toolbar">
            <button class="btn-primary with-icon" onclick={oncreate}
              ><Plus size={14} />Create link</button
            ><button onclick={onbulkcreate}>Import / paste</button>
          </div>
        </div>
      {:else}<div class="box-frame empty-state">
          <h2 class="break">No links match “{query}”</h2>
          <p class="muted">
            Search looks at labels, destinations and short addresses.
          </p>
          <div class="toolbar">
            <button class="with-icon" onclick={() => onsearch("")}
              ><X size={14} />Clear search</button
            >
          </div>
        </div>{/if}
    {:else}<div class="table-scroll">
        <table class="grid-table">
          <thead
            ><tr
              >{#if mode === "manage"}<th class="selection-cell"
                  ><input
                    type="checkbox"
                    aria-label="Select all visible links"
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
              >{#if mode === "manage"}<th class="action-cell">Actions</th
                >{/if}</tr
            ></thead
          ><tbody>
            {#each state.value as row (row.id)}<tr
                >{#if mode === "manage"}<td class="selection-cell"
                    ><input
                      type="checkbox"
                      aria-label={`Select ${row.label}`}
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
                      aria-label={`Copy short address ${row.address}`}
                      title="Copy short address"
                      onclick={() => onaction("copy", row.id)}
                      ><code>{row.address}</code></button
                    >{:else}<code>{row.address}</code>{/if}</td
                ><td class="compact-cell">{row.clicks.toLocaleString()}</td><td
                  class="compact-cell"
                  ><span class:off={!row.enabled} class="link-status"
                    >{row.enabled ? "Enabled" : "Disabled"}</span
                  ></td
                >{#if mode === "manage"}<td class="action-cell"
                    ><div class="row-actions">
                      {#each primaryActions as primary}<button
                          class="row-action with-icon"
                          data-action={primary.action}
                          aria-label={primary.name}
                          title={primary.name}
                          onclick={() => onaction(primary.action, row.id)}
                          ><primary.icon size={14} /><span>{primary.label}</span
                          ></button
                        >{/each}<RowMenu
                        label={`More actions for ${row.label}`}
                        items={menuItems(row.enabled)}
                        onselect={(id) => {
                          if (isLinkAction(id)) onaction(id, row.id);
                        }}
                      />
                    </div></td
                  >{/if}</tr
              >{/each}
          </tbody>
        </table>
      </div>{/if}
  {/if}
</section>
