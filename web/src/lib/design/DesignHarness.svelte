<script lang="ts">
  import { appName } from "../adapters/branding";
  import { simulatedLinkRows } from "../fixtures";
  import { filterLinks, type LinkRow, type LinkAction } from "../view-models";
  import DesignWorkspace from "./DesignWorkspace.svelte";
  import DesignPopover from "./DesignPopover.svelte";
  import DesignModal from "./DesignModal.svelte";
  import "../styles/presentation.css";
  let {
    direction = "precision",
  }: { direction?: "precision" | "paper" | "studio" } = $props();
  let rows = $state<readonly LinkRow[]>(
    simulatedLinkRows.map((row) => ({ ...row })),
  );
  let search = $state("");
  type Overlay =
    | { kind: "closed" }
    | { kind: "create" }
    | { kind: "edit"; id: number }
    | { kind: "import" }
    | { kind: "stats" | "address"; id: number; anchor: HTMLButtonElement };
  let overlay = $state<Overlay>({ kind: "closed" });
  let draft = $state({ title: "", destination: "", alias: "" });
  let error = $state("");
  let feedback = $state("");
  let detailRow = $derived.by(() => {
    const current = overlay;
    return current.kind === "stats" || current.kind === "address"
      ? rows.find((row) => row.id === current.id)
      : undefined;
  });
  function close() {
    overlay = { kind: "closed" };
    error = "";
  }
  let importText = $state("");
  function open(id?: number) {
    const row = rows.find((row) => row.id === id);
    draft = row
      ? {
          title: row.label,
          destination: row.destination,
          alias: row.address.split("/").pop() ?? "",
        }
      : { title: "", destination: "", alias: "" };
    overlay = row ? { kind: "edit", id: row.id } : { kind: "create" };
    error = "";
    feedback = "";
  }
  function save() {
    let url: URL;
    try {
      url = new URL(draft.destination);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      error = "Enter a full http:// or https:// destination.";
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(draft.alias)) {
      error = "Use letters, numbers, hyphens or underscores for the alias.";
      return;
    }
    const current = overlay.kind === "edit" ? overlay.id : null;
    if (
      rows.some(
        (row) =>
          row.id !== current && row.address === `example.com/${draft.alias}`,
      )
    ) {
      error = "This alias is already in use. Choose another alias.";
      return;
    }
    const row: LinkRow = {
      id: current ?? Math.max(0, ...rows.map((row) => row.id)) + 1,
      label: draft.title.trim() || draft.alias,
      destination: url.href,
      address: `example.com/${draft.alias}`,
      clicks: 0,
      enabled: true,
    };
    rows =
      current === null
        ? [row, ...rows]
        : rows.map((old) =>
            old.id === current
              ? {
                  ...old,
                  label: row.label,
                  destination: row.destination,
                  address: row.address,
                }
              : old,
          );
    overlay = { kind: "closed" };
    error = "";
    search = "";
    feedback = current === null ? "Link created." : "Link updated.";
  }
  function action(action: LinkAction, id: number, anchor: HTMLButtonElement) {
    const row = rows.find((row) => row.id === id);
    if (!row) return;
    if (action === "toggle") {
      close();
      rows = rows.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item,
      );
      feedback = `${row.label} ${row.enabled ? "disabled" : "enabled"}.`;
    } else if (action === "edit") open(id);
    else {
      feedback = "";
      overlay = { kind: action === "copy" ? "address" : "stats", id, anchor };
    }
  }
  function importLinks() {
    const lines = importText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      !lines.length ||
      lines.some((line) => {
        try {
          return !["http:", "https:"].includes(new URL(line).protocol);
        } catch {
          return true;
        }
      })
    ) {
      error = "Enter one full http:// or https:// destination per line.";
      return;
    }
    const start = Math.max(0, ...rows.map((row) => row.id)) + 1;
    rows = [
      ...lines.map((destination, i): LinkRow => ({
        id: start + i,
        label: new URL(destination).hostname,
        destination,
        address: `example.com/import-${start + i}`,
        clicks: 0,
        enabled: true,
      })),
      ...rows,
    ];
    feedback = `${lines.length} ${lines.length === 1 ? "link" : "links"} imported.`;
    close();
    importText = "";
    error = "";
    search = "";
  }
</script>

<DesignWorkspace
  {appName}
  {direction}
  {rows}
  visibleRows={filterLinks(rows, search)}
  {search}
  {feedback}
  onsearch={(value) => {
    search = value;
    close();
  }}
  oncreate={() => open()}
  onimport={() => {
    overlay = { kind: "import" };
    error = "";
    feedback = "";
    importText = "";
  }}
  onaction={action}
>
  {#snippet form()}
    {#if (overlay.kind === "stats" || overlay.kind === "address") && detailRow}
      <DesignPopover
        kind={overlay.kind}
        row={detailRow}
        anchor={overlay.anchor}
        onclose={close}
      />
    {:else if overlay.kind === "create" || overlay.kind === "edit"}
      <DesignModal onclose={close}>
        <form
          class="dl-modal-form"
          onsubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div class="dl-section-heading">
            <h3>{overlay.kind === "edit" ? "Edit link" : "Create link"}</h3>
            <button type="button" class="dl-quiet" onclick={close}
              >Cancel</button
            >
          </div>
          <div class="dl-fields">
            <label
              >Title<input
                placeholder="A useful name"
                bind:value={draft.title}
              /></label
            ><label
              >Short alias<input
                placeholder="e.g. project-notes"
                bind:value={draft.alias}
              /></label
            ><label class="dl-full"
              >Destination<input
                placeholder="https://example.org/page"
                bind:value={draft.destination}
              /></label
            >
          </div>
          {#if error}<p class="dl-error">{error}</p>{/if}
          <div class="dl-form-footer">
            <button class="dl-primary" type="submit">Save link</button>
          </div>
        </form>
      </DesignModal>
    {:else if overlay.kind === "import"}
      <DesignModal onclose={close}>
        <form
          class="dl-modal-form"
          onsubmit={(event) => {
            event.preventDefault();
            importLinks();
          }}
        >
          <div class="dl-section-heading">
            <h3>Import links</h3>
            <button type="button" onclick={close}>Cancel</button>
          </div>
          <label
            >Destinations, one per line<textarea
              placeholder="https://example.org/notes"
              bind:value={importText}></textarea></label
          >
          {#if error}<p class="dl-error">{error}</p>{/if}
          <div class="dl-form-footer">
            <button class="dl-primary" type="submit">Import links</button>
          </div>
        </form>
      </DesignModal>
    {/if}
  {/snippet}
</DesignWorkspace>
