<script lang="ts">
  import DesignHarness from "./DesignHarness.svelte";
  import DashboardHarness from "../story-harness/DashboardHarness.svelte";
  let {
    direction = "precision",
  }: { direction?: "compare" | "precision" | "paper" | "studio" } = $props();
</script>

{#if direction === "paper" || direction === "studio"}<DesignHarness
    {direction}
  />{:else}<DashboardHarness />{/if}
