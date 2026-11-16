<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    identity,
    children,
  }: {
    identity?: { label: string; address: string; destination: string };
    children: Snippet;
  } = $props();
</script>

<main class="app-shell management-page">
  {#if identity}<div class="management-identity stack">
      <a href="/">← Back to links</a>
      <div>
        <strong>{identity.label}</strong>
        <p class="muted break">{identity.address}</p>
        <p class="muted break">{identity.destination}</p>
      </div>
    </div>{/if}
  {@render children()}
</main>
