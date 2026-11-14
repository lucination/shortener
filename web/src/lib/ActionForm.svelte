<script lang="ts">
  import type { Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  export type ActionFormView =
    | { kind: "confirm"; title: string; description: string }
    | {
        kind: "value";
        title: string;
        description: string;
        label: string;
        value: string;
        type: "email" | "number" | "datetime-local";
      };
  let {
    view,
    outcome,
    onchange = () => {},
    onconfirm = () => {},
    oncancel = () => {},
  }: {
    view: ActionFormView;
    outcome: Outcome;
    onchange?: (value: string) => void;
    onconfirm?: () => void;
    oncancel?: () => void;
  } = $props();
</script>

<form
  class="box-frame stack mb-lh"
  onsubmit={(event) => {
    event.preventDefault();
    onconfirm();
  }}
>
  <h2>{view.title}</h2>
  <p>{view.description}</p>
  {#if view.kind === "value"}<label class="field max-w-lg"
      >{view.label}<input
        type={view.type}
        value={view.value}
        oninput={(event) => onchange(event.currentTarget.value)}
      /></label
    >{/if}<ResourceStatus state={outcome} />
  <div class="toolbar">
    <button class="btn-primary" disabled={outcome.kind === "pending"}
      >Confirm</button
    ><button
      type="button"
      onclick={oncancel}
      disabled={outcome.kind === "pending"}>Cancel</button
    >
  </div>
</form>
