<script lang="ts">
  // Story-only state; these are the production presentation components.
  import { appName } from "../adapters/branding";
  import AppShell from "../AppShell.svelte";
  import Dashboard from "../Dashboard.svelte";
  import LinkEditor from "../LinkEditor.svelte";
  import BulkImport from "../BulkImport.svelte";
  import Analytics from "../Analytics.svelte";
  import AccountPanel from "../AccountPanel.svelte";
  import ActionForm from "../ActionForm.svelte";
  import FocusedModal from "../presentation/FocusedModal.svelte";
  import {
    simulatedLinks,
    simulatedLinkRows,
    simulatedStatsView,
    simulatedEventRows,
  } from "../fixtures";
  import { linkDraft } from "../mappings";
  import {
    emptyDraft,
    filterLinks,
    toggleSelection,
    type LinkDraft,
    type LinkAction,
    type Outcome,
    type EditorMode,
    type EnrollmentState,
  } from "../view-models";
  import { parseBulk } from "../bulk";
  import { parseDraft } from "../adapters/draft";
  let query = $state("");
  let selected: readonly number[] = $state([]);
  let rows = $state(simulatedLinkRows.map((row) => ({ ...row })));
  let drafts = $state<Record<number, LinkDraft>>(
    Object.fromEntries(
      simulatedLinks.map((link) => [link.id, linkDraft(link)]),
    ),
  );
  type Overlay =
    | { kind: "closed" }
    | { kind: "editor"; mode: EditorMode; draft: LinkDraft }
    | { kind: "import"; text: string }
    | { kind: "stats" | "events"; label: string }
    | { kind: "delete"; id: number };
  let overlay = $state<Overlay>({ kind: "closed" });
  let outcome: Outcome = $state({ kind: "idle" });
  let section = $state<"links" | "account">("links");
  let retention = $state("90");
  let enrollment = $state<EnrollmentState>({ kind: "idle" });
  const close = () => {
    overlay = { kind: "closed" };
    outcome = { kind: "idle" };
  };
  function save() {
    if (overlay.kind !== "editor") return;
    const parsed = parseDraft(overlay.draft);
    if (parsed.kind === "invalid") {
      outcome = {
        kind: "error",
        reason: "validation",
        message: parsed.message,
      };
      return;
    }
    const editor = overlay;
    const id =
      editor.mode.kind === "edit"
        ? editor.mode.id
        : Math.max(0, ...rows.map((row) => row.id)) + 1;
    const old = rows.find((row) => row.id === id);
    const row = {
      id,
      label: editor.draft.title || editor.draft.alias || `Link ${id}`,
      destination: editor.draft.destination,
      address:
        old?.address || `example.com/${editor.draft.alias || `link-${id}`}`,
      clicks: old?.clicks || 0,
      enabled: old?.enabled ?? true,
    };
    rows = old
      ? rows.map((item) => (item.id === id ? row : item))
      : [row, ...rows];
    drafts = { ...drafts, [id]: editor.draft };
    query = "";
    close();
  }
  function action(action: LinkAction, id: number) {
    const row = rows.find((row) => row.id === id);
    if (!row) return;
    close();
    if (action === "edit")
      overlay = {
        kind: "editor",
        mode: { kind: "edit", id },
        draft: drafts[id] || {
          ...emptyDraft,
          title: row.label,
          destination: row.destination,
        },
      };
    else if (action === "delete") overlay = { kind: "delete", id };
    else if (action === "toggle")
      rows = rows.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item,
      );
    else if (action === "stats" || action === "events")
      overlay = { kind: action, label: row.label };
    else outcome = { kind: "success", message: row.address };
  }
  function importRows() {
    if (overlay.kind !== "import") return;
    const parsed = parseBulk(overlay.text);
    if (!parsed.length || parsed.some((row) => row.kind === "invalid")) return;
    let id = Math.max(0, ...rows.map((row) => row.id));
    rows = [
      ...parsed.flatMap((row) =>
        row.kind === "valid"
          ? [
              {
                id: ++id,
                label: row.alias || row.destination,
                destination: row.destination,
                address: `example.com/${row.alias || `link-${id}`}`,
                clicks: 0,
                enabled: true,
              },
            ]
          : [],
      ),
      ...rows,
    ];
    close();
  }
</script>

<AppShell
  {appName}
  {section}
  authenticated
  onnav={(next) => {
    section = next;
    close();
  }}
>
  {#if section === "account"}<AccountPanel
      email="reader@example.org"
      {retention}
      {enrollment}
      {outcome}
      onretention={(value) => (retention = value)}
      onsave={() =>
        (outcome = { kind: "success", message: "Retention saved." })}
      onenroll={() =>
        (enrollment = {
          kind: "succeeded",
          message: "Passkey added to your account.",
        })}
    />
  {:else}
    <Dashboard
      state={{ kind: "ready", value: filterLinks(rows, query) }}
      search={query}
      {selected}
      onsearch={(value) => (query = value)}
      onselect={(id) => (selected = toggleSelection(selected, id))}
      oncreate={() => {
        close();
        overlay = {
          kind: "editor",
          mode: { kind: "create" },
          draft: emptyDraft,
        };
      }}
      onbulkcreate={() => {
        close();
        overlay = { kind: "import", text: "" };
      }}
      onaction={action}
      onbulk={(action) => {
        rows =
          action === "delete"
            ? rows.filter((row) => !selected.includes(row.id))
            : rows.map((row) =>
                selected.includes(row.id) &&
                (action === "enable" || action === "disable")
                  ? { ...row, enabled: action === "enable" }
                  : row,
              );
        selected = [];
      }}
    />
    {#if overlay.kind !== "closed"}<FocusedModal
        onclose={close}
        wide={overlay.kind === "stats" || overlay.kind === "events"}
      >
        {#if overlay.kind === "editor"}<LinkEditor
            mode={overlay.mode}
            draft={overlay.draft}
            {outcome}
            onchange={(draft) => {
              if (overlay.kind === "editor") overlay = { ...overlay, draft };
            }}
            onsubmit={save}
            oncancel={close}
          />
        {:else if overlay.kind === "import"}<BulkImport
            text={overlay.text}
            rows={parseBulk(overlay.text)}
            {outcome}
            onchange={(text) => (overlay = { kind: "import", text })}
            onsubmit={importRows}
            oncancel={close}
          />
        {:else if overlay.kind === "delete"}<ActionForm
            view={{
              kind: "confirm",
              title: "Delete this link?",
              description: "Deleted addresses remain reserved.",
            }}
            {outcome}
            oncancel={close}
            onconfirm={() => {
              if (overlay.kind === "delete") {
                const id = overlay.id;
                rows = rows.filter((row) => row.id !== id);
                close();
              }
            }}
          />
        {:else}<Analytics
            view={overlay.kind === "stats"
              ? {
                  kind: "stats",
                  label: overlay.label,
                  state: { kind: "ready", value: simulatedStatsView },
                }
              : {
                  kind: "events",
                  label: overlay.label,
                  state: { kind: "ready", value: simulatedEventRows },
                }}
            range={{ from: "2026-11-08", to: "2026-11-14" }}
            onback={close}
          />{/if}
      </FocusedModal>{/if}
  {/if}
</AppShell>
