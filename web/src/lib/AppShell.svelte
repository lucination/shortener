<script lang="ts">
  import type { Snippet } from "svelte";
  export type Section =
    | "links"
    | "account"
    | "users"
    | "admin-links"
    | "usage"
    | "admin-events"
    | "admin-login";
  export type Theme = "system" | "light" | "dark";
  let {
    children,
    section,
    theme,
    onnav = () => {},
    ontheme = () => {},
    onlogout = () => {},
  }: {
    children: Snippet;
    section: Section;
    theme: Theme;
    onnav?: (section: Section) => void;
    ontheme?: (theme: Theme) => void;
    onlogout?: () => void;
  } = $props();
  const navigation: readonly { key: Section; label: string }[] = [
    { key: "links", label: "Links" },
    { key: "account", label: "Account" },
    { key: "admin-login", label: "Admin" },
  ];
  const adminNavigation: readonly { key: Section; label: string }[] = [
    { key: "users", label: "Users" },
    { key: "admin-links", label: "Links" },
    { key: "usage", label: "Usage" },
    { key: "admin-events", label: "Events" },
  ];
</script>

<main class="app-shell">
  <header class="toolbar spread">
    <div class="toolbar">
      <strong>Shortener / SHORTENER</strong><span class="muted"
        >────────────────</span
      >
    </div>
    <div class="toolbar">
      <label
        >Theme <select
          value={theme}
          onchange={(event) => {
            const value = event.currentTarget.value;
            if (value === "system" || value === "light" || value === "dark")
              ontheme(value);
          }}
          ><option value="system">System</option><option value="light"
            >Light</option
          ><option value="dark">Dark</option></select
        ></label
      ><button onclick={onlogout}>Sign out</button>
    </div>
  </header>
  <hr class="rule" />
  <nav class="toolbar">
    {#each navigation as item}<button
        class:btn-primary={section === item.key}
        onclick={() => onnav(item.key)}>{item.label}</button
      >{/each}{#if ["users", "admin-links", "usage", "admin-events"].includes(section)}<span
        class="muted">/ ADMIN</span
      >{#each adminNavigation as item}<button
          class:btn-primary={section === item.key}
          onclick={() => onnav(item.key)}>{item.label}</button
        >{/each}{/if}
  </nav>
  <hr class="rule" />
  {@render children()}
  <footer class="mt-2lh">
    <hr class="rule" />
    <div class="toolbar spread muted">
      <span>Shortener / Small links. Clear ownership.</span><span
        >Character-grid design · The Monospace Web / MIT</span
      >
    </div>
  </footer>
</main>
