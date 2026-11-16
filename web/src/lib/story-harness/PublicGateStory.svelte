<script lang="ts">
  import type { PublicView, Outcome } from "../view-models";
  import PublicPage from "../PublicPage.svelte";
  import documentTemplate from "../presentation/native-document.html?raw";
  import passwordTemplate from "../presentation/native-password.html?raw";
  import previewTemplate from "../presentation/native-preview.html?raw";
  import errorTemplate from "../presentation/native-unlock-error.html?raw";
  import css from "../../app.css?inline";
  let { page, outcome }: { page: PublicView; outcome: Outcome } = $props();
  // The native Rust handler and this sandbox consume the same HTML templates.
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const fill = (template: string, values: Readonly<Record<string, string>>) =>
    template.replace(/\{([a-z]+)\}/g, (_, key: string) => values[key] ?? "");
  const html = $derived.by(() => {
    if (page.kind === "not-found") return "";
    const common = { code: "story-link", query: "" };
    const content =
      page.kind === "password"
        ? fill(
            outcome.kind === "error" ? errorTemplate : passwordTemplate,
            common,
          )
        : fill(previewTemplate, {
            ...common,
            title: escape(page.title || "Link preview"),
            description: escape(page.description),
            destination: escape(page.destination),
          });
    return fill(documentTemplate, {
      title: page.kind === "password" ? "Protected link" : "Preview",
      content,
    }).replace(
      '<link rel=stylesheet href="/presentation.css">',
      `<style>${css}</style>`,
    );
  });
</script>

{#if page.kind === "not-found"}<main class="app-shell">
    <PublicPage {page} {outcome} />
  </main>{:else}<iframe
    title="Native public page"
    srcdoc={html}
    sandbox="allow-same-origin"
    style="width:100%;height:100vh;border:0;"
  ></iframe>{/if}
