<script lang="ts">
  import { appName } from "$shared/adapters/branding";
  import { onMount } from "svelte";
  import AuthPanel from "$shared/AuthPanel.svelte";
  import AdminPanel from "$shared/AdminPanel.svelte";
  import ActionForm, { type ActionFormView } from "$shared/ActionForm.svelte";
  import FocusedModal from "$shared/presentation/FocusedModal.svelte";
  import ResourceStatus from "$shared/ResourceStatus.svelte";
  import { createAdminApi } from "$shared/adapters/api";
  import { resultResource, failureOutcome } from "$shared/resource";
  import { userRow, linkRow, eventRow } from "$shared/mappings";
  import type { AdminView, Outcome, UserAction } from "$shared/view-models";
  type Session =
    | { kind: "discovering" }
    | { kind: "discovery-failed"; error: Extract<Outcome, { kind: "error" }> }
    | { kind: "login"; token: string }
    | { kind: "authenticated"; epoch: symbol; view: AdminView };
  type Command =
    | { kind: "none" }
    | { kind: "create"; value: string }
    | { kind: "user"; id: number; action: UserAction; value: string };
  const api = createAdminApi(fetch);
  let session: Session = $state({ kind: "discovering" });
  let outcome: Outcome = $state({ kind: "idle" });
  let command: Command = $state({ kind: "none" });
  let generation = 0;
  async function load(kind: AdminView["kind"]) {
    const request = ++generation;
    const admission =
      session.kind === "authenticated"
        ? { kind: "current" as const, epoch: session.epoch }
        : { kind: "discovery" as const, epoch: Symbol("session") };
    command = { kind: "none" };
    session =
      admission.kind === "current"
        ? {
            kind: "authenticated",
            epoch: admission.epoch,
            view: { kind, state: { kind: "pending" } },
          }
        : { kind: "discovering" };
    outcome = { kind: "idle" };
    function finish<T>(
      result: import("../../web/src/lib/adapters/api").Result<T>,
      view: AdminView,
    ) {
      if (request !== generation) return;
      session =
        result.kind === "failed" &&
        result.error.kind === "http" &&
        [401, 403].includes(result.error.status)
          ? { kind: "login", token: "" }
          : result.kind === "failed" && admission.kind === "discovery"
            ? { kind: "discovery-failed", error: failureOutcome(result.error) }
            : { kind: "authenticated", epoch: admission.epoch, view };
    }
    if (kind === "users") {
      const r = await api.users();
      finish(r, {
        kind,
        state: resultResource(r, (v) => v.items.map(userRow)),
      });
    } else if (kind === "links") {
      const r = await api.adminLinks();
      finish(r, {
        kind,
        state: resultResource(r, (v) => v.items.map(linkRow)),
      });
    } else if (kind === "events") {
      const r = await api.adminEvents();
      finish(r, {
        kind,
        state: resultResource(r, (v) => v.items.map(eventRow)),
      });
    } else {
      const r = await api.usage();
      finish(r, {
        kind,
        state: resultResource(r, (v) => [
          { label: "Users", count: v.users },
          { label: "Links", count: v.links },
          { label: "Redirects", count: v.redirects },
          { label: "Raw events", count: v.raw_events },
        ]),
      });
    }
  }
  onMount(() => {
    void load("users");
    return () => {
      generation++;
      session = { kind: "login", token: "" };
    };
  });
  async function login() {
    if (session.kind !== "login" || outcome.kind === "pending") return;
    const request = generation;
    outcome = { kind: "pending" };
    const result = await api.adminLogin({ token: session.token });
    if (request !== generation) return;
    if (result.kind === "ok") {
      session = {
        kind: "authenticated",
        epoch: Symbol("session"),
        view: { kind: "users", state: { kind: "pending" } },
      };
      await load("users");
    } else outcome = failureOutcome(result.error);
  }
  async function logout() {
    if (session.kind !== "authenticated") return;
    const owner = session.epoch;
    const request = ++generation;
    outcome = { kind: "pending" };
    const result = await api.adminLogout();
    if (session.kind !== "authenticated" || owner !== session.epoch) return;
    if (result.kind === "ok") {
      generation++;
      session = { kind: "login", token: "" };
      command = { kind: "none" };
      outcome = { kind: "idle" };
    } else if (request === generation) outcome = failureOutcome(result.error);
  }
  function commandView(c: Exclude<Command, { kind: "none" }>): ActionFormView {
    if (c.kind === "create")
      return {
        kind: "value",
        title: "Add user",
        description: "Create an account before email sign in.",
        label: "Email address",
        type: "email",
        value: c.value,
      };
    if (c.action === "quota" || c.action === "retention")
      return {
        kind: "value",
        title: `Change ${c.action}`,
        description: "Blank restores the default. Quota may be zero.",
        label: c.action === "quota" ? "Link quota" : "Retention days",
        type: "number",
        value: c.value,
      };
    return {
      kind: "confirm",
      title: `${c.action} user #${c.id}?`,
      description:
        "Only this account is changed. Signing out preserves passkeys.",
    };
  }
  async function confirm() {
    if (command.kind === "none" || outcome.kind === "pending") return;
    const c = command;
    const request = generation;
    const n = c.value.trim() ? Number(c.value) : null;
    if (
      c.kind === "user" &&
      (c.action === "quota" || c.action === "retention") &&
      n !== null &&
      (!Number.isSafeInteger(n) || n < (c.action === "quota" ? 0 : 1))
    ) {
      outcome = { kind: "error", message: "Enter a valid whole number." };
      return;
    }
    outcome = { kind: "pending" };
    const result =
      c.kind === "create"
        ? await api.createUser({
            email: c.value,
            retention_days: null,
            link_quota: null,
          })
        : c.action === "delete"
          ? await api.removeUser(c.id)
          : c.action === "signout"
            ? await api.signoutUser(c.id)
            : await api.patchUser(c.id, {
                suspended:
                  c.action === "suspend"
                    ? true
                    : c.action === "reactivate"
                      ? false
                      : null,
                deleted: c.action === "reactivate" ? false : null,
                ...(c.action === "quota" ? { link_quota: n } : {}),
                ...(c.action === "retention" ? { retention_days: n } : {}),
              });
    if (request !== generation) return;
    if (result.kind === "failed") {
      outcome = failureOutcome(result.error);
      return;
    }
    command = { kind: "none" };
    await load("users");
  }
</script>

<main class="app-shell">
  <header class="toolbar spread">
    <strong>{appName} / Administration</strong
    >{#if session.kind === "authenticated"}<button onclick={logout}
        >Sign out</button
      >{/if}
  </header>
  <hr class="rule" />
  {#if session.kind === "discovering"}
    <ResourceStatus state={{ kind: "pending" }} />
  {:else if session.kind === "discovery-failed"}
    <ResourceStatus state={session.error} onretry={() => void load("users")} />
  {:else if session.kind === "login"}
    <AuthPanel
      {appName}
      mode={{ kind: "admin", token: session.token }}
      {outcome}
      onchange={(m) => {
        if (m.kind === "admin") session = { kind: "login", token: m.token };
      }}
      onsubmit={login}
    />
  {:else}
    <nav class="toolbar">
      {#each ["users", "links", "usage", "events"] as kind}<button
          class:btn-primary={session.view.kind === kind}
          onclick={() => {
            command = { kind: "none" };
            void load(kind as AdminView["kind"]);
          }}>{kind[0].toUpperCase() + kind.slice(1)}</button
        >{/each}
    </nav>
    <hr class="rule" />
    {#if command.kind !== "none"}<FocusedModal
        onclose={() => {
          if (outcome.kind !== "pending") {
            generation++;
            command = { kind: "none" };
            outcome = { kind: "idle" };
          }
        }}
        ><ActionForm
          view={commandView(command)}
          {outcome}
          onchange={(value) => {
            if (command.kind !== "none") command = { ...command, value };
          }}
          onconfirm={confirm}
          oncancel={() => {
            generation++;
            command = { kind: "none" };
            outcome = { kind: "idle" };
          }}
        /></FocusedModal
      >{/if}
    <AdminPanel
      view={session.view}
      outcome={command.kind === "none" ? outcome : { kind: "idle" }}
      oncreate={() => {
        generation++;
        command = { kind: "create", value: "" };
        outcome = { kind: "idle" };
      }}
      onuser={(action, id) => {
        generation++;
        command = { kind: "user", action, id, value: "" };
        outcome = { kind: "idle" };
      }}
      onretry={() => {
        if (session.kind === "authenticated") void load(session.view.kind);
      }}
    />
  {/if}
</main>
