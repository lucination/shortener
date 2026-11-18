<script lang="ts">
  import type { Notice } from "./view-models";
  let { notice }: { notice: Notice } = $props();
</script>

<!-- The live region stays mounted so assistive technology announces each new
     notice; only its transient content changes. -->
<div class="toast-region" role="status" aria-live="polite" aria-atomic="true">
  {#if notice.kind !== "idle"}<div
      class="toast"
      class:toast-error={notice.kind === "error"}
    >
      {notice.message}
    </div>{/if}
</div>

<style>
  /* Out of flow and zero-sized so notices never move page content. */
  .toast-region {
    position: fixed;
    left: 0;
    bottom: 0;
    width: 0;
    height: 0;
    z-index: 50;
    pointer-events: none;
  }
  .toast {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: max-content;
    max-width: min(280px, calc(100vw - 16px));
    padding: 6px 10px;
    border: 1px solid var(--dl-line);
    border-radius: 6px;
    background: var(--dl-panel);
    color: var(--dl-text);
    font-size: 12px;
    line-height: 1.5;
    box-shadow: 0 10px 24px rgb(0 0 0 / 20%);
    white-space: normal;
  }
  .toast-error {
    color: var(--dl-danger);
  }
</style>
