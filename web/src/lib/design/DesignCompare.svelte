<script lang="ts">
  import DesignHarness from "./DesignHarness.svelte";
  let {
    direction = "precision",
  }: { direction?: "compare" | "precision" | "paper" | "studio" } = $props();
</script>

<DesignHarness direction={direction === "compare" ? "precision" : direction} />
