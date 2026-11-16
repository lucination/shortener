<script lang="ts">
  import type { LinkDraft, EditorMode, Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    mode,
    draft,
    outcome,
    onchange = () => {},
    onsubmit = () => {},
    oncancel = () => {},
  }: {
    mode: EditorMode;
    draft: LinkDraft;
    outcome: Outcome;
    onchange?: (draft: LinkDraft) => void;
    onsubmit?: () => void;
    oncancel?: () => void;
  } = $props();
  const fields: readonly {
    key:
      | "destination"
      | "alias"
      | "title"
      | "description"
      | "password"
      | "expiresAt"
      | "clickLimit"
      | "retentionDays";
    label: string;
    type: string;
    placeholder: string;
  }[] = [
    {
      key: "destination",
      label: "Destination URL",
      type: "url",
      placeholder: "https://example.org/your-page",
    },
    {
      key: "alias",
      label: "Custom alias",
      type: "text",
      placeholder: "Optional; generated when blank",
    },
    {
      key: "title",
      label: "Title",
      type: "text",
      placeholder: "A name you can find later",
    },
    {
      key: "description",
      label: "Description",
      type: "text",
      placeholder: "Shown on the preview page",
    },
    {
      key: "password",
      label: "Password",
      type: "password",
      placeholder: "Blank leaves current password unchanged",
    },
    {
      key: "expiresAt",
      label: "Expiration",
      type: "datetime-local",
      placeholder: "",
    },
    {
      key: "clickLimit",
      label: "Click limit",
      type: "number",
      placeholder: "No limit",
    },
    {
      key: "retentionDays",
      label: "Raw event retention (days)",
      type: "number",
      placeholder: "Use account default",
    },
  ];
</script>

<section class="stack">
  <div>
    <h1>{mode.kind === "create" ? "New link" : "Edit link"}</h1>
  </div>
  <form
    data-testid="link-editor"
    class="stack box-frame"
    onsubmit={(event) => {
      event.preventDefault();
      onsubmit();
    }}
  >
    <div class="form-grid">
      {#each fields as field}<label class="field"
          >{field.label}<input
            type={field.type}
            value={draft[field.key]}
            placeholder={field.placeholder}
            disabled={outcome.kind === "pending" ||
              (mode.kind === "edit" && field.key === "alias")}
            required={field.key === "destination"}
            min={field.type === "number" ? 1 : undefined}
            oninput={(event) =>
              onchange({ ...draft, [field.key]: event.currentTarget.value })}
          /></label
        >{/each}
      <label class="field"
        >Incoming query parameters<select
          value={draft.queryMode}
          onchange={(event) => {
            const value = event.currentTarget.value;
            if (
              value === "discard" ||
              value === "preserve" ||
              value === "override"
            )
              onchange({ ...draft, queryMode: value });
          }}
          ><option value="discard">Discard incoming parameters</option><option
            value="preserve">Preserve destination values</option
          ><option value="override">Override destination values</option></select
        ></label
      >
      <label class="toolbar"
        ><input
          type="checkbox"
          checked={draft.interstitial}
          onchange={(event) =>
            onchange({ ...draft, interstitial: event.currentTarget.checked })}
        /> Show preview before redirect</label
      >
    </div>
    <p class="muted">
      Aliases stay reserved permanently. Raw-event retention does not remove
      daily aggregates.
    </p>
    <ResourceStatus state={outcome} />
    <div class="toolbar">
      <button class="btn-primary" disabled={outcome.kind === "pending"}
        >{outcome.kind === "pending" ? "Saving…" : "Save link"}</button
      ><button type="button" onclick={oncancel}>Cancel</button>
    </div>
  </form>
</section>
