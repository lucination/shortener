<script lang="ts">
  import ManagementFrame from "../ManagementFrame.svelte";
  import Analytics from "../Analytics.svelte";
  import LinkEditor from "../LinkEditor.svelte";
  import type { Resource, StatsView, Outcome } from "../view-models";
  import { linkDraft } from "../mappings";
  import { simulatedLinks, simulatedStatsView } from "../fixtures";
  let {
    kind = "statistics",
    state = { kind: "ready", value: simulatedStatsView },
    outcome = { kind: "idle" },
  }: {
    kind?: "statistics" | "edit";
    state?: Resource<StatsView>;
    outcome?: Outcome;
  } = $props();
  const link = simulatedLinks[0];
</script>

<ManagementFrame
  identity={{
    label: "Field notes",
    address: "example.com/notes",
    destination: link.destination,
  }}
>
  {#if kind === "statistics"}<Analytics
      view={{ kind: "stats", label: "Field notes", state }}
      range={{ from: "2026-11-08", to: "2026-11-14" }}
    />
  {:else}<LinkEditor
      mode={{ kind: "edit", id: link.id }}
      draft={{
        ...linkDraft(link),
        alias: "a".repeat(64),
        destination: `https://example.org/${"long-path/".repeat(30)}`,
      }}
      {outcome}
    />{/if}
</ManagementFrame>
