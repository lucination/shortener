<script lang="ts">
  import type { Snippet } from "svelte";
  export type Section = "links" | "account";
  let {
    children,
    section,
    authenticated = false,
    onnav = () => {},
    onlogout = () => {},
  }: {
    children: Snippet;
    section: Section;
    authenticated?: boolean;
    onnav?: (section: Section) => void;
    onlogout?: () => void;
  } = $props();
</script>

<main class="app-shell">
  <header class="toolbar spread">
    <strong>Shortener / SHORTENER</strong>
    {#if authenticated}<button onclick={onlogout}>Sign out</button>{/if}
  </header>
  <hr class="rule" />
  {#if authenticated}<nav class="toolbar">
      <button
        class:btn-primary={section === "links"}
        onclick={() => onnav("links")}>Links</button
      >
      <button
        class:btn-primary={section === "account"}
        onclick={() => onnav("account")}>Account</button
      >
    </nav>
    <hr class="rule" />{/if}
  {@render children()}
</main>
