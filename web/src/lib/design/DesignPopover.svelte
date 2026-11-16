<script lang="ts">
  import type { LinkRow } from "../view-models";
  let {
    kind,
    row,
    anchor,
    onclose,
  }: {
    kind: "stats" | "address";
    row: LinkRow;
    anchor: HTMLButtonElement;
    onclose: () => void;
  } = $props();
  let panel: HTMLDivElement;
  let address = $state<HTMLInputElement>();
  let position = $state({ left: 8, top: 8 });
  $effect(() => {
    const target = anchor;
    const current = panel;
    // Re-measure after content/row changes as well as viewport and table scrolling.
    void row;
    void kind;
    function place() {
      const a = target.getBoundingClientRect();
      const p = current.getBoundingClientRect();
      const below = a.bottom + 4;
      position = {
        left: Math.max(
          8,
          Math.min(a.right - p.width, innerWidth - p.width - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            below + p.height <= innerHeight - 8 ? below : a.top - p.height - 4,
            innerHeight - p.height - 8,
          ),
        ),
      };
    }
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !current.contains(event.target) &&
        !target.contains(event.target)
      )
        onclose();
    }
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("pointerdown", outside);
    };
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") onclose();
  }}
/>
<div
  class="dl-popover"
  bind:this={panel}
  style:left={`${position.left}px`}
  style:top={`${position.top}px`}
  data-link-id={row.id}
>
  <div class="dl-section-heading">
    <h3>{row.label}</h3>
    <button onclick={onclose}>Close</button>
  </div>
  {#if kind === "stats"}
    <div class="dl-click-detail">
      <span>Clicks</span><strong>{row.clicks.toLocaleString("en-US")}</strong>
    </div>
  {:else}
    <label
      >Short address<input
        bind:this={address}
        value={row.address}
        readonly
        onclick={(event) => event.currentTarget.select()}
      /></label
    >
    <div class="dl-form-footer">
      <button
        onclick={() => {
          address?.focus();
          address?.select();
        }}>Select address</button
      >
    </div>
  {/if}
</div>
