<script lang="ts">
  import { onMount } from "svelte";
  import AppShell, { type Section } from "../AppShell.svelte";
  import Dashboard from "../Dashboard.svelte";
  import LinkEditor from "../LinkEditor.svelte";
  import BulkImport from "../BulkImport.svelte";
  import Analytics from "../Analytics.svelte";
  import AccountPanel from "../AccountPanel.svelte";
  import AuthPanel from "../AuthPanel.svelte";
  import PublicPage from "../PublicPage.svelte";
  import ActionForm, { type ActionFormView } from "../ActionForm.svelte";
  import ResourceStatus from "../ResourceStatus.svelte";
  import { createApi, type Api, type Result } from "../adapters/api";
  import { parseDraft } from "../adapters/draft";
  import { parseBulk } from "../bulk";
  import { linkRow, linkDraft, statsView, eventRow } from "../mappings";
  import { mapResource, resultResource, failureOutcome } from "../resource";
  import {
    filterLinks,
    toggleSelection,
    emptyDraft,
    type Resource,
    type Outcome,
    type LinkAction,
    type BulkAction,
    type EditorMode,
    type LinkDraft,
    type AnalyticsView,
    type DateRange,
    type AuthMode,
  } from "../view-models";
  import type {
    Link,
    User,
    Message,
    BulkAction as WireBulkAction,
  } from "../generated";
  import { enrollPasskey, authenticatePasskey } from "../adapters/passkeys";
  type Page =
    | {
        kind: "links";
        state: Resource<readonly Link[]>;
        search: string;
        selected: readonly number[];
      }
    | { kind: "editor"; mode: EditorMode; draft: LinkDraft }
    | { kind: "import"; text: string }
    | { kind: "analytics"; id: number; view: AnalyticsView; range: DateRange }
    | {
        kind: "account";
        user: User;
        retention: string;
        enrollment: import("../view-models").EnrollmentState;
      }
    | { kind: "auth"; mode: AuthMode }
    | { kind: "not-found" };
  type Command =
    | { kind: "none" }
    | {
        kind: "bulk";
        ids: readonly number[];
        action: BulkAction;
        value: string;
      }
    | { kind: "delete-link"; id: number }
    | { kind: "remove-password"; id: number }
    | { kind: "signout" };
  let { api = createApi(fetch) }: { api?: Api } = $props();
  let page: Page = $state({
    kind: "links",
    state: { kind: "pending" },
    search: "",
    selected: [],
  });
  let outcome: Outcome = $state({ kind: "idle" });
  let command: Command = $state({ kind: "none" });
  let authenticated = $state(false);
  let generation = 0;
  const section = (): Section =>
    page.kind === "account" ? "account" : "links";
  const initialRange = (): DateRange => {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 6);
    return { from: start.toISOString().slice(0, 10), to: end };
  };
  function notify<T>(result: Result<T>, message: string): boolean {
    outcome =
      result.kind === "ok"
        ? { kind: "success", message }
        : failureOutcome(result.error);
    return result.kind === "ok";
  }
  function setPage(next: Page) {
    generation++;
    page = next;
    command = { kind: "none" };
    outcome = { kind: "idle" };
  }
  async function loadLinks() {
    setPage({
      kind: "links",
      state: { kind: "pending" },
      search: "",
      selected: [],
    });
    const request = generation;
    const result = await api.links();
    if (request !== generation) return;
    if (
      result.kind === "failed" &&
      result.error.kind === "http" &&
      [401, 403].includes(result.error.status)
    ) {
      authenticated = false;
      setPage({ kind: "auth", mode: { kind: "magic", email: "" } });
      return;
    }
    page = {
      kind: "links",
      state: resultResource(result, (value) => value.items),
      search: "",
      selected: [],
    };
  }
  async function navigate(target: Section) {
    if (target === "links") await loadLinks();
    else if (target === "account") {
      const request = ++generation;
      const result = await api.me();
      if (request !== generation) return;
      if (result.kind === "ok")
        setPage({
          kind: "account",
          user: result.value,
          enrollment: { kind: "idle" },
          retention:
            result.value.retention_days === null
              ? ""
              : String(result.value.retention_days),
        });
      else notify(result, "");
    }
  }
  async function start() {
    if (location.pathname !== "/") {
      setPage({ kind: "not-found" });
      return;
    }
    const request = ++generation;
    const result = await api.me();
    if (request !== generation) return;
    if (result.kind === "ok") {
      authenticated = true;
      await loadLinks();
    } else if (
      result.error.kind === "http" &&
      [401, 403].includes(result.error.status)
    )
      setPage({ kind: "auth", mode: { kind: "magic", email: "" } });
    else
      page = {
        kind: "links",
        state: failureOutcome(result.error),
        search: "",
        selected: [],
      };
  }
  onMount(() => {
    void start();
    return () => {
      generation++;
    };
  });
  async function authenticate() {
    if (page.kind !== "auth" || outcome.kind === "pending") return;
    const mode = page.mode;
    const request = generation;
    outcome = { kind: "pending" };
    if (mode.kind === "magic") {
      const result = await api.magic({ email: mode.email });
      if (request !== generation) return;
      notify(result, result.kind === "ok" ? result.value.message : "");
    }
  }
  async function passkeyLogin() {
    if (
      page.kind !== "auth" ||
      page.mode.kind !== "magic" ||
      outcome.kind === "pending"
    )
      return;
    const email = page.mode.email;
    const request = generation;
    outcome = { kind: "pending" };
    const result = await authenticatePasskey(api, email);
    if (request !== generation) return;
    if (notify(result, "Signed in.")) {
      authenticated = true;
      await loadLinks();
    }
  }
  async function enroll() {
    if (page.kind !== "account" || page.enrollment.kind === "enrolling") return;
    const request = generation;
    page = { ...page, enrollment: { kind: "enrolling" } };
    const result = await enrollPasskey(api);
    if (request !== generation || page.kind !== "account") return;
    page = {
      ...page,
      enrollment:
        result.kind === "ok"
          ? { kind: "succeeded", message: "Passkey added to your account." }
          : { kind: "failed", message: result.error.message },
    };
  }
  async function logout() {
    if (outcome.kind === "pending") return;
    const request = generation;
    outcome = { kind: "pending" };
    const result = await api.logout();
    if (request !== generation) return;
    if (notify(result, "Signed out.")) {
      authenticated = false;
      setPage({ kind: "auth", mode: { kind: "magic", email: "" } });
    }
  }
  async function saveLink() {
    if (page.kind !== "editor" || outcome.kind === "pending") return;
    const editor = page;
    const request = generation;
    const parsed = parseDraft(editor.draft);
    if (parsed.kind === "invalid") {
      outcome = {
        kind: "error",
        reason: "validation",
        message: parsed.message,
      };
      return;
    }
    outcome = { kind: "pending" };
    const result =
      editor.mode.kind === "create"
        ? await api.create(parsed.input)
        : await api.patch(editor.mode.id, parsed.patch);
    if (request !== generation) return;
    if (notify(result, "Link saved.")) await loadLinks();
  }
  async function action(action: LinkAction, id: number) {
    if (
      page.kind !== "links" ||
      page.state.kind !== "ready" ||
      outcome.kind === "pending"
    )
      return;
    const request = generation;
    const link = page.state.value.find((link) => link.id === id);
    if (!link) return;
    if (action === "edit")
      setPage({
        kind: "editor",
        mode: { kind: "edit", id },
        draft: linkDraft(link),
      });
    else if (action === "copy") {
      const address = link.addresses[0];
      if (!address) {
        outcome = { kind: "error", message: "No address to copy." };
        return;
      }
      try {
        await navigator.clipboard.writeText(
          `https://${address.domain}/${address.short_code}`,
        );
        outcome = { kind: "success", message: "Short address copied." };
      } catch {
        outcome = {
          kind: "error",
          message: "Clipboard unavailable. Select and copy the short address.",
        };
      }
    } else if (action === "delete") command = { kind: "delete-link", id };
    else if (action === "toggle") {
      outcome = { kind: "pending" };
      const result = await api.patch(id, { enabled: !link.enabled });
      if (request !== generation) return;
      if (notify(result, "Link updated.")) await loadLinks();
    } else
      await loadAnalytics(
        id,
        link.title || `Link #${id}`,
        action === "stats" ? "stats" : "events",
        initialRange(),
      );
  }
  async function loadAnalytics(
    id: number,
    label: string,
    kind: "stats" | "events",
    range: DateRange,
  ) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(range.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(range.to) ||
      range.from > range.to
    ) {
      outcome = {
        kind: "error",
        reason: "validation",
        message: "Choose a valid inclusive date range.",
      };
      return;
    }
    setPage({
      kind: "analytics",
      id,
      range,
      view: { kind, label, state: { kind: "pending" } },
    });
    const request = generation;
    if (kind === "stats") {
      const result = await api.stats(id, range);
      if (request === generation)
        page = {
          kind: "analytics",
          id,
          range,
          view: { kind, label, state: resultResource(result, statsView) },
        };
    } else {
      const result = await api.events(id, range);
      if (request === generation)
        page = {
          kind: "analytics",
          id,
          range,
          view: {
            kind,
            label,
            state: resultResource(result, (value) => value.items.map(eventRow)),
          },
        };
    }
  }
  async function importLinks() {
    if (page.kind !== "import" || outcome.kind === "pending") return;
    const rows = parseBulk(page.text);
    if (!rows.length || rows.some((row) => row.kind === "invalid")) return;
    const items = rows.flatMap((row) => {
      if (row.kind !== "valid") return [];
      const parsed = parseDraft({
        ...emptyDraft,
        destination: row.destination,
        alias: row.alias,
      });
      return parsed.kind === "valid" ? [parsed.input] : [];
    });
    if (items.length !== rows.length) return;
    outcome = { kind: "pending" };
    const result = await api.bulk({ items });
    if (result.kind === "failed") {
      notify(result, "");
      return;
    }
    const failed = result.value.items.filter((row) => row.status === "failed");
    const created = result.value.items.filter(
      (row) => row.status === "created",
    );
    page = {
      kind: "import",
      text: failed
        .flatMap((row) => {
          const source = rows[row.index];
          return source?.kind === "valid"
            ? [`${source.destination},${source.alias}`]
            : [];
        })
        .join("\n"),
    };
    outcome = failed.length
      ? {
          kind: "error",
          message: result.value.items
            .map(
              (row) =>
                `Row ${row.index + 1}: ${row.status === "created" ? "created" : row.error.message}`,
            )
            .join(" · "),
        }
      : {
          kind: "success",
          message: `Created ${created.length} links. Return to links to manage them.`,
        };
  }
  async function readFile(file: File) {
    if (file.size > 1024 * 1024) {
      outcome = {
        kind: "error",
        message: "CSV exceeds the 1 MiB browser import limit.",
      };
      return;
    }
    try {
      const text = await file.text();
      if (page.kind === "import") page = { kind: "import", text };
    } catch {
      outcome = { kind: "error", message: "Could not read the selected file." };
    }
  }
  async function saveAccount() {
    if (page.kind !== "account" || outcome.kind === "pending") return;
    const request = generation;
    const value = page.retention.trim() ? Number(page.retention) : null;
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
      outcome = {
        kind: "error",
        reason: "validation",
        message: "Retention must be a positive whole number.",
      };
      return;
    }
    outcome = { kind: "pending" };
    const result = await api.account({ retention_days: value });
    if (request !== generation || page.kind !== "account") return;
    if (notify(result, "Retention saved.") && result.kind === "ok")
      page = {
        kind: "account",
        user: result.value,
        enrollment: page.enrollment,
        retention:
          result.value.retention_days === null
            ? ""
            : String(result.value.retention_days),
      };
  }
  function commandView(
    value: Exclude<Command, { kind: "none" }>,
  ): ActionFormView {
    if (
      value.kind === "bulk" &&
      (value.action === "expiration" || value.action === "retention")
    )
      return {
        kind: "value",
        title: `Set ${value.action} for ${value.ids.length} links`,
        description:
          "Blank clears the override. Only selected link IDs are changed.",
        label: value.action === "expiration" ? "Expiration" : "Retention days",
        type: value.action === "expiration" ? "datetime-local" : "number",
        value: value.value,
      };
    return {
      kind: "confirm",
      title:
        value.kind === "signout"
          ? "Sign out everywhere?"
          : value.kind === "remove-password"
            ? "Remove link password?"
            : value.kind === "delete-link"
              ? "Soft-delete this link?"
              : value.kind === "bulk"
                ? `${value.action} ${value.ids.length} links?`
                : "Confirm action?",
      description:
        "This action changes the server state only after confirmation. Deleted addresses remain reserved; passkeys are preserved when sessions are revoked.",
    };
  }
  function commandValue(value: string) {
    if (command.kind === "bulk") command = { ...command, value };
  }
  async function confirmCommand() {
    if (command.kind === "none" || outcome.kind === "pending") return;
    const target = command;
    outcome = { kind: "pending" };
    let result: Result<unknown>;
    try {
      const number = (value: string, allowZero = false): number | null => {
        if (!value.trim()) return null;
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1))
          throw Error("Enter a valid whole number.");
        return parsed;
      };
      if (target.kind === "delete-link") result = await api.remove(target.id);
      else if (target.kind === "remove-password")
        result = await api.patch(target.id, { password: null });
      else if (target.kind === "signout")
        result = await api.signoutEverywhere();
      else if (target.kind === "bulk") {
        const action: WireBulkAction =
          target.action === "expiration"
            ? {
                type: "expiration",
                expires_at: target.value
                  ? new Date(target.value).toISOString()
                  : null,
              }
            : target.action === "retention"
              ? { type: "retention", retention_days: number(target.value) }
              : { type: target.action };
        const bulkResult = await api.bulkUpdate({
          ids: [...target.ids],
          action,
        });
        if (bulkResult.kind === "ok") {
          const failures = bulkResult.value.items.filter(
            (item) => item.status === "failed",
          );
          if (failures.length) {
            outcome = {
              kind: "error",
              reason: "validation",
              message: failures
                .map((item) => `Link #${item.id}: ${item.error.message}`)
                .join(" · "),
            };
            return;
          }
        }
        result = bulkResult;
      } else return;
    } catch (error) {
      outcome = {
        kind: "error",
        reason: "validation",
        message: error instanceof Error ? error.message : "Invalid action.",
      };
      return;
    }
    if (!notify(result, "Action completed.")) return;
    command = { kind: "none" };
    if (target.kind === "signout") {
      authenticated = false;
      setPage({ kind: "auth", mode: { kind: "magic", email: "" } });
    } else await loadLinks();
  }
</script>

<AppShell
  section={section()}
  {authenticated}
  onnav={navigate}
  onlogout={logout}
>
  {#if command.kind !== "none"}<ActionForm
      view={commandView(command)}
      {outcome}
      onchange={commandValue}
      onconfirm={confirmCommand}
      oncancel={() => {
        command = { kind: "none" };
        outcome = { kind: "idle" };
      }}
    />{:else if page.kind !== "auth" && page.kind !== "editor" && page.kind !== "import" && page.kind !== "account"}<ResourceStatus
      state={outcome}
    />{/if}
  {#if page.kind === "links"}<Dashboard
      state={mapResource(page.state, (links) =>
        filterLinks(
          links.map(linkRow),
          page.kind === "links" ? page.search : "",
        ),
      )}
      search={page.search}
      selected={page.selected}
      onsearch={(search) => {
        if (page.kind === "links") page = { ...page, search };
      }}
      onselect={(id) => {
        if (page.kind === "links")
          page = { ...page, selected: toggleSelection(page.selected, id) };
      }}
      oncreate={() =>
        setPage({
          kind: "editor",
          mode: { kind: "create" },
          draft: emptyDraft,
        })}
      onbulkcreate={() => setPage({ kind: "import", text: "" })}
      onaction={action}
      onbulk={(action) => {
        if (page.kind === "links")
          command = { kind: "bulk", ids: page.selected, action, value: "" };
      }}
      onretry={loadLinks}
    />
  {:else if page.kind === "editor"}<LinkEditor
      mode={page.mode}
      draft={page.draft}
      {outcome}
      onchange={(draft) => {
        if (page.kind === "editor") page = { ...page, draft };
      }}
      onsubmit={saveLink}
      oncancel={loadLinks}
    />{#if page.mode.kind === "edit"}<button
        class="mt-lh"
        onclick={() => {
          if (page.kind === "editor" && page.mode.kind === "edit")
            command = { kind: "remove-password", id: page.mode.id };
        }}>Remove existing password</button
      >{/if}
  {:else if page.kind === "import"}<BulkImport
      text={page.text}
      rows={parseBulk(page.text)}
      {outcome}
      onchange={(text) => {
        if (page.kind === "import") page = { kind: "import", text };
      }}
      onfile={readFile}
      onsubmit={importLinks}
      oncancel={loadLinks}
    />
  {:else if page.kind === "analytics"}<Analytics
      view={page.view}
      range={page.range}
      onrange={(range) => {
        if (page.kind === "analytics") page = { ...page, range };
      }}
      onapply={() => {
        if (page.kind === "analytics")
          void loadAnalytics(
            page.id,
            page.view.label,
            page.view.kind,
            page.range,
          );
      }}
      onback={loadLinks}
    />
  {:else if page.kind === "auth"}<AuthPanel
      mode={page.mode}
      {outcome}
      onchange={(mode) => {
        if (page.kind === "auth") page = { kind: "auth", mode };
      }}
      onsubmit={authenticate}
      onpasskey={passkeyLogin}
    />
  {:else if page.kind === "account"}<AccountPanel
      email={page.user.email}
      retention={page.retention}
      enrollment={page.enrollment}
      {outcome}
      onretention={(retention) => {
        if (page.kind === "account") page = { ...page, retention };
      }}
      onsave={saveAccount}
      onenroll={enroll}
      onsignout={() => (command = { kind: "signout" })}
      onlogout={logout}
    />
  {:else}<PublicPage
      page={{ kind: "not-found" }}
      outcome={{ kind: "idle" }}
    />{/if}
</AppShell>
