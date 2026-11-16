<script lang="ts">
  import { DEFAULT_APP_NAME } from "./app-name";
  import type { Snippet } from "svelte";
  export type Section = "links" | "account";
  let {
    appName = DEFAULT_APP_NAME,
    children,
    section,
    authenticated = false,
    onnav = () => {},
    onlogout = () => {},
  }: {
    appName?: string;
    children: Snippet;
    section: Section;
    authenticated?: boolean;
    onnav?: (section: Section) => void;
    onlogout?: () => void;
  } = $props();
</script>

<main class="app-shell">
  <header class="toolbar spread">
    <strong>{appName}</strong>
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
