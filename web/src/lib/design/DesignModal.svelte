<script lang="ts">
  import type { Snippet } from "svelte";
  import FocusedModal from "../presentation/FocusedModal.svelte";
  let { children, onclose }: { children: Snippet; onclose: () => void } =
    $props();
</script>

<FocusedModal {onclose}>{@render children()}</FocusedModal>
