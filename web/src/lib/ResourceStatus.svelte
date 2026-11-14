<script lang="ts">
  import type { Resource, Outcome } from "./view-models";
  let {
    state,
    onretry,
  }: { state: Resource<unknown> | Outcome; onretry?: () => void } = $props();
</script>

{#if state.kind === "pending"}<div class="box-frame">Loading…</div>
{:else if state.kind === "error"}<div class="box-frame">
    <p class="error">{state.message}</p>
    {#if onretry}<button onclick={onretry}>Retry</button>{/if}
  </div>
{:else if state.kind === "success"}<p>{state.message}</p>{/if}
