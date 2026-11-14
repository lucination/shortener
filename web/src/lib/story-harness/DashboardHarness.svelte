<script lang="ts">
  // Story-only state. Production presentation remains controlled and effect-free.
  import Dashboard from "../Dashboard.svelte";
  import LinkEditor from "../LinkEditor.svelte";
  import BulkImport from "../BulkImport.svelte";
  import Analytics from "../Analytics.svelte";
  import {
    simulatedLinkRows,
    simulatedStatsView,
    simulatedEventRows,
  } from "../fixtures";
  import {
    emptyDraft,
    filterLinks,
    toggleSelection,
    type LinkDraft,
    type LinkAction,
    type Outcome,
  } from "../view-models";
  import { parseBulk } from "../bulk";
  let query = $state("");
  let selected: readonly number[] = $state([]);
  let rows = $state(simulatedLinkRows.map((row) => ({ ...row })));
  let text = $state("");
  let message = $state("");
  let screen:
    | { kind: "links" }
    | { kind: "editor"; draft: LinkDraft }
    | { kind: "import" }
    | { kind: "stats" }
    | { kind: "events" } = $state({ kind: "links" });
  let outcome: Outcome = $state({ kind: "idle" });
  function action(action: LinkAction, id: number) {
    message = action === "copy" ? "Short address copied." : "";
    if (action === "toggle")
      rows = rows.map((row) =>
        row.id === id ? { ...row, enabled: !row.enabled } : row,
      );
    if (action === "delete") rows = rows.filter((row) => row.id !== id);
    if (action === "stats" || action === "events") screen = { kind: action };
    if (action === "edit") {
      const row = rows.find((row) => row.id === id);
      if (row)
        screen = {
          kind: "editor",
          draft: {
            ...emptyDraft,
            destination: row.destination,
            title: row.label,
          },
        };
    }
  }
</script>

{#if message}<p class="mb-lh">{message}</p>{/if}
{#if screen.kind === "links"}<Dashboard
    state={{ kind: "ready", value: filterLinks(rows, query) }}
    search={query}
    {selected}
    onsearch={(value) => (query = value)}
    onselect={(id) => (selected = toggleSelection(selected, id))}
    oncreate={() => {
      screen = { kind: "editor", draft: emptyDraft };
      outcome = { kind: "idle" };
    }}
    onbulkcreate={() => (screen = { kind: "import" })}
    onaction={action}
    onbulk={(action) =>
      (message = `${action} completed for ${selected.length} links.`)}
  />
{:else if screen.kind === "editor"}<LinkEditor
    mode={{ kind: "create" }}
    draft={screen.draft}
    {outcome}
    onchange={(draft) => (screen = { kind: "editor", draft })}
    onsubmit={() => (outcome = { kind: "success", message: "Link saved." })}
    oncancel={() => (screen = { kind: "links" })}
  />
{:else if screen.kind === "import"}<BulkImport
    {text}
    rows={parseBulk(text)}
    {outcome}
    onchange={(value) => (text = value)}
    onsubmit={() => (outcome = { kind: "success", message: "Links imported." })}
    oncancel={() => (screen = { kind: "links" })}
  />
{:else}<Analytics
    view={screen.kind === "stats"
      ? {
          kind: "stats",
          label: "Field notes",
          state: { kind: "ready", value: simulatedStatsView },
        }
      : {
          kind: "events",
          label: "Field notes",
          state: { kind: "ready", value: simulatedEventRows },
        }}
    range={{ from: "2026-11-08", to: "2026-11-14" }}
    onback={() => (screen = { kind: "links" })}
  />{/if}
