<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  let { children, onclose }: { children: Snippet; onclose: () => void } =
    $props();
  let dialog: HTMLDialogElement;
  onMount(() => {
    dialog
      .querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")
      ?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  });
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") onclose();
  }}
/>
<div class="dl-modal-layer">
  <button class="dl-backdrop" title="Close dialog" onclick={onclose}></button>
  <dialog open class="dl-modal" bind:this={dialog}>
    {@render children()}
  </dialog>
</div>
