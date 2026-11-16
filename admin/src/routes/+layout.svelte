<script lang="ts">
  import { appName } from "$shared/adapters/branding";
  import "../../../web/src/app.css";
  let { children } = $props();
</script>

<svelte:head><title>{appName} / Administration</title></svelte:head>

{@render children()}
