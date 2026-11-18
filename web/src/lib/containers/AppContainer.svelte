<script lang="ts">
  import { copyAddress, type CopyAddress } from "../adapters/clipboard";
  import { managementUrl } from "../management";
  import { appName } from "../adapters/branding";
  import { onMount, onDestroy, flushSync } from "svelte";
  import AppShell, { type Section } from "../AppShell.svelte";
  import Dashboard from "../Dashboard.svelte";
  import FocusedModal from "../presentation/FocusedModal.svelte";
  import LinkEditor from "../LinkEditor.svelte";
  import BulkImport from "../BulkImport.svelte";
  import Analytics from "../Analytics.svelte";
  import AccountPanel from "../AccountPanel.svelte";
  import AuthPanel from "../AuthPanel.svelte";
  import PublicPage from "../PublicPage.svelte";
  import ActionForm from "../ActionForm.svelte";
  import ResourceStatus from "../ResourceStatus.svelte";
  import Toast from "../Toast.svelte";
  import { createApi, type Api } from "../adapters/api";
  import { failureOutcome } from "../resource";
  import type { LinkAction, DateRange } from "../view-models";
  import { Generation } from "./generation";
  import { SessionState, unauthorized } from "./session.svelte";
  import { PageOutcome } from "./outcome.svelte";
  import { ToastController } from "./toast.svelte";
  import { AuthController } from "./auth.svelte";
  import { AccountController } from "./account.svelte";
  import { LinksController } from "./links.svelte";
  import { CommandController, type Command } from "./commands.svelte";
  import { EditorController } from "./editor.svelte";
  import { ImportController } from "./import.svelte";
  import {
    AnalyticsController,
    initialRange,
    validRange,
  } from "./analytics.svelte";

  let {
    api = createApi(fetch),
    copy = copyAddress,
    navigateTo = (path: string) => location.assign(path),
  }: {
    api?: Api;
    copy?: CopyAddress;
    navigateTo?: (path: string) => void;
  } = $props();

  type Page =
    | "links"
    | "editor"
    | "import"
    | "analytics"
    | "account"
    | "auth"
    | "not-found";
  let page: Page = $state("links");

  // Shared authorities. The generation fences every stale completion; each
  // controller below owns its own state and reset/cancel semantics.
  const generation = new Generation();
  const session = new SessionState();
  const outcome = new PageOutcome();
  const toast = new ToastController();
  // Props are injected once, like constructor arguments.
  // svelte-ignore state_referenced_locally
  const effects = { api, copy, generation, session, outcome, toast };
  const account: AccountController = new AccountController({
    ...effects,
    active: () => page === "account",
    loginBusy: (): boolean => auth.loginBusy,
  });
  const auth: AuthController = new AuthController({
    ...effects,
    active: () => page === "auth",
    enrollmentBusy: (): boolean => account.passkeys.enrollmentBusy,
    signedIn: async () => {
      session.authenticate();
      await loadLinks();
    },
  });
  const links = new LinksController({
    ...effects,
    active: () => page === "links",
  });
  const commands = new CommandController({
    ...effects,
    signedOut: showSignIn,
    completed: loadLinks,
  });
  const editor = new EditorController({
    ...effects,
    active: () => page === "editor",
  });
  const importer = new ImportController({
    ...effects,
    active: () => page === "import",
  });
  const analytics = new AnalyticsController(effects);

  onDestroy(() => {
    account.abandon();
    toast.clear();
    generation.advance();
  });
  // A full-document navigation can freeze this component in the back/forward
  // cache without unmounting it. Clear synchronously before that snapshot.
  onMount(() => {
    const hide = () => flushSync(() => generation.advance());
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  });
  onMount(() => {
    void start();
    return () => {
      generation.advance();
      auth.reset();
      session.signOut();
    };
  });

  const section = (): Section => (page === "account" ? "account" : "links");

  /** Every screen replacement fences older work and resets per-screen state. */
  function setPage(next: Page) {
    account.abandon();
    toast.clear();
    generation.advance();
    account.reset();
    auth.reset();
    page = next;
    commands.reset();
    outcome.reset();
  }
  function beginCommand(next: Command) {
    account.abandon();
    generation.advance();
    toast.clear();
    commands.open(next);
  }
  function showSignIn() {
    session.signOut();
    setPage("auth");
    auth.open();
  }
  /** Restores the links screen; `notice` reports the action that led here. */
  async function loadLinks(notice?: string) {
    if (!session.authenticated) return;
    setPage("links");
    if (notice) toast.show("success", notice);
    if ((await links.load()) === "unauthorized") showSignIn();
  }
  async function navigate(target: Section) {
    account.abandon();
    if (target === "links") await loadLinks();
    else if (target === "account") {
      const request = generation.advance();
      const result = await api.me();
      if (!generation.owns(request)) return;
      if (result.kind === "ok") {
        setPage("account");
        await account.open(result.value);
      } else outcome.notify(result, "");
    }
  }
  async function start() {
    if (location.pathname !== "/") {
      setPage("not-found");
      return;
    }
    const request = generation.advance();
    session.discover();
    const result = await api.me();
    if (!generation.owns(request)) return;
    if (result.kind === "ok") {
      session.authenticate();
      await loadLinks();
    } else if (unauthorized(result)) showSignIn();
    else session.fail(failureOutcome(result.error));
  }
  async function logout() {
    account.abandon();
    const owner = session.epoch;
    if (owner === null) return;
    // Success owns the session; failure feedback still owns the initiating page.
    const request = generation.advance();
    outcome.begin();
    const result = await api.logout();
    if (!session.owns(owner)) return;
    if (result.kind === "ok") showSignIn();
    else if (generation.owns(request)) outcome.notify(result, "");
  }
  async function saveLink() {
    const notice = await editor.save();
    if (notice) await loadLinks(notice);
  }
  async function loadAnalytics(
    id: number,
    label: string,
    kind: "stats" | "events",
    range: DateRange,
  ) {
    if (!validRange(range)) {
      outcome.fail("Choose a valid inclusive date range.", "validation");
      return;
    }
    setPage("analytics");
    await analytics.load(id, label, kind, range);
  }
  async function action(action: LinkAction, id: number) {
    if (!links.actionable) return;
    const link = links.find(id);
    if (!link) return;
    if (action === "edit" || action === "stats") {
      const code = link.addresses[0]?.short_code;
      const path =
        code && managementUrl(code, action === "edit" ? "edit" : "statistics");
      if (path) navigateTo(path);
    } else if (action === "copy") await links.copyAddress(id);
    else if (action === "delete") beginCommand({ kind: "delete-link", id });
    else if (action === "toggle") {
      if (await links.toggle(id)) await loadLinks("Link updated.");
    } else
      await loadAnalytics(
        id,
        link.title || `Link #${id}`,
        "events",
        initialRange(),
      );
  }
</script>

{#if page === "not-found"}
  <main class="app-shell">
    <PublicPage
      {appName}
      page={{ kind: "not-found" }}
      outcome={{ kind: "idle" }}
    />
  </main>
{:else if session.value.kind === "anonymous" && page === "auth"}
  <AuthPanel
    {appName}
    mode={auth.mode}
    state={auth.state}
    outcome={outcome.value}
    onchange={(mode) => auth.setMode(mode)}
    onsubmit={() => auth.sendMagicLink()}
    onpasskey={() => auth.passkeyLogin()}
    oncancel={() => auth.cancelPasskey()}
  />
{:else}
  <AppShell
    {appName}
    section={section()}
    authenticated={session.authenticated}
    onnav={navigate}
    onlogout={logout}
  >
    {#if commands.view}<FocusedModal onclose={() => commands.dismiss()}
        ><ActionForm
          view={commands.view}
          outcome={outcome.value}
          onchange={(value) => commands.setValue(value)}
          onconfirm={() => commands.confirm()}
          oncancel={() => commands.cancel()}
        /></FocusedModal
      >{:else if page !== "auth" && page !== "editor" && page !== "import" && page !== "account" && outcome.value.kind !== "success"}<ResourceStatus
        state={outcome.value}
      />{/if}
    {#if session.value.kind === "discovering"}<ResourceStatus
        state={{ kind: "pending" }}
      />
    {:else if session.value.kind === "failed"}<ResourceStatus
        state={session.value.error}
        onretry={start}
      />
    {:else if page === "links"}<Dashboard
        state={links.rows}
        search={links.search}
        selected={links.selected}
        onsearch={(search) => links.setSearch(search)}
        onselect={(id) => links.select(id)}
        onselectall={(checked) => links.selectAll(checked)}
        oncreate={() => {
          setPage("editor");
          editor.open({ kind: "create" });
        }}
        onbulkcreate={() => {
          setPage("import");
          importer.open();
        }}
        onaction={action}
        onbulk={(action) => {
          if (page === "links")
            beginCommand({
              kind: "bulk",
              ids: links.selected,
              action,
              value: "",
            });
        }}
        onretry={() => loadLinks()}
      />
    {:else if page === "editor"}{#if !commands.command}<FocusedModal
          onclose={() => loadLinks()}
          ><LinkEditor
            mode={editor.mode}
            draft={editor.draft}
            outcome={outcome.value}
            onchange={(draft) => editor.setDraft(draft)}
            onsubmit={saveLink}
            oncancel={() => loadLinks()}
          />{#if editor.mode.kind === "edit"}<button
              class="mt-lh"
              onclick={() => {
                if (page === "editor" && editor.mode.kind === "edit")
                  beginCommand({ kind: "remove-password", id: editor.mode.id });
              }}>Remove existing password</button
            >{/if}</FocusedModal
        >{/if}
    {:else if page === "import"}<FocusedModal onclose={() => loadLinks()}
        ><BulkImport
          text={importer.text}
          rows={importer.rows}
          outcome={outcome.value}
          onchange={(text) => importer.setText(text)}
          onfile={(file) => importer.readFile(file)}
          onsubmit={() => importer.submit()}
          oncancel={() => loadLinks()}
        /></FocusedModal
      >
    {:else if page === "analytics"}<FocusedModal
        onclose={() => loadLinks()}
        wide
        ><Analytics
          view={analytics.view}
          range={analytics.range}
          onrange={(range) => {
            if (page === "analytics") analytics.setRange(range);
          }}
          onapply={() => {
            if (page === "analytics")
              void loadAnalytics(
                analytics.id,
                analytics.view.label,
                analytics.view.kind,
                analytics.range,
              );
          }}
          onback={() => loadLinks()}
        /></FocusedModal
      >
    {:else if page === "account" && account.user}<AccountPanel
        accessTokens={{
          tokens: account.tokens.tokens,
          name: account.tokens.name,
          days: account.tokens.days,
          issued: account.tokens.issued,
          feedback: account.tokens.feedback,
          onname: (value) => (account.tokens.name = value),
          ondays: (value) => (account.tokens.days = value),
          oncreate: () => account.tokens.issue(),
          onrevoke: (id) => account.tokens.revoke(id),
          oncopy: () => account.tokens.copySecret(),
          ondismiss: () => account.tokens.clearSecret(),
          onretry: () => account.tokens.load(),
        }}
        enrollmentBusy={account.passkeys.enrollmentBusy}
        passkeyName={account.passkeys.name}
        passkeys={account.passkeys.keys}
        passkeyEdits={account.passkeys.edits}
        passkeyFeedback={account.passkeys.feedback}
        onpasskeyname={(name) => (account.passkeys.name = name)}
        onpasskeyedit={(id, name) => account.passkeys.edit(id, name)}
        onpasskeyrename={(id) => account.passkeys.rename(id)}
        onpasskeyretry={() => account.passkeys.load()}
        email={account.user.email}
        retention={account.retention}
        enrollment={account.passkeys.enrollment}
        outcome={outcome.value}
        onretention={(retention) => {
          if (page === "account") account.retention = retention;
        }}
        onsave={() => account.saveRetention()}
        onenroll={() => account.passkeys.enroll()}
        onsignout={() => beginCommand({ kind: "signout" })}
        onlogout={logout}
      />
    {:else}<PublicPage
        {appName}
        page={{ kind: "not-found" }}
        outcome={{ kind: "idle" }}
      />{/if}
    <Toast notice={toast.notice} />
  </AppShell>
{/if}
