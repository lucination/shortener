<script lang="ts">
  import { appName } from "$lib/adapters/branding";
  import "../app.css";
  let { children } = $props();
</script>

<svelte:head><title>{appName}</title></svelte:head>

{@render children()}
