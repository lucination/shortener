<script lang="ts">
  import LinkEditor from "../LinkEditor.svelte";
  import ManagementFrame from "../ManagementFrame.svelte";
  import { simulatedLinks } from "../fixtures";
  import type { EditorMode, LinkDraft, Outcome } from "../view-models";
  let {
    mode,
    draft,
    outcome,
  }: { mode: EditorMode; draft: LinkDraft; outcome: Outcome } = $props();
</script>

{#snippet editor()}<LinkEditor {mode} {draft} {outcome} />{/snippet}
{#if mode.kind === "edit"}
  <ManagementFrame
    identity={{
      label: draft.title || draft.alias || "Link",
      address: `${simulatedLinks[0].addresses[0].domain}/${draft.alias}`,
      destination: draft.destination,
    }}
  >
    {@render editor()}
  </ManagementFrame>
{:else}{@render editor()}{/if}
