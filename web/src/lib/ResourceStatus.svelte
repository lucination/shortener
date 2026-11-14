<script lang="ts">
  import type { Resource, Outcome } from "./view-models";
  let {
    state,
    onretry,
  }: { state: Resource<unknown> | Outcome; onretry?: () => void } = $props();
</script>

{#if state.kind === "pending"}<div class="box-frame">Loading…</div>
{:else if state.kind === "error"}<div class="box-frame">
    <strong class="error"
      >{state.reason === "network"
        ? "Connection unavailable"
        : state.reason === "authentication"
          ? "Sign in required"
          : state.reason === "validation"
            ? "Check your input"
            : "Request not completed"}</strong
    >
    <p>{state.message}</p>
    {#if !onretry}<p class="muted">
        {state.reason === "authentication"
          ? "Sign in again, then retry this action."
          : state.reason === "validation"
            ? "Correct the highlighted values and submit again."
            : "Your input is preserved. Try the action again."}
      </p>{/if}
    {#if onretry}<button onclick={onretry}>Retry</button>{/if}
  </div>
{:else if state.kind === "success"}<p>{state.message}</p>{/if}
