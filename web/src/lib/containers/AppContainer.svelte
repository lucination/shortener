<script lang="ts">
  import { copyAddress, type CopyAddress } from "../adapters/clipboard";
  import { parsePasskeyName } from "../passkey-name";
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
  import ActionForm, { type ActionFormView } from "../ActionForm.svelte";
  import ResourceStatus from "../ResourceStatus.svelte";
  import { createApi, type Api, type Result } from "../adapters/api";
  import { parseDraft } from "../adapters/draft";
  import { parseBulk } from "../bulk";
  import { linkRow, linkDraft, statsView, eventRow } from "../mappings";
  import { mapResource, resultResource, failureOutcome } from "../resource";
  import {
    filterLinks,
    bulkActionLabels,
    toggleSelection,
    emptyDraft,
    type Resource,
    type CopyFeedback,
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
  import type { SignInState } from "../sign-in";
  let passkeyAttempt: AbortController | undefined;
  // Retain even an abandoned attempt until its options/cookie/credential work
  // settles. No replacement may steal the service-global WebAuthn owner.
  let enrollmentAttempt = $state.raw<
    | { controller: AbortController; phase: "preparing" | "verifying" }
    | undefined
  >();
  function abandonEnrollment() {
    if (enrollmentAttempt?.phase === "preparing")
      enrollmentAttempt.controller.abort();
  }
  onDestroy(abandonEnrollment);
  let signInState: SignInState = $state({ kind: "idle" });
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
  let {
    api = createApi(fetch),
    copy = copyAddress,
    navigateTo = (path: string) => location.assign(path),
  }: {
    api?: Api;
    copy?: CopyAddress;
    navigateTo?: (path: string) => void;
  } = $props();
  let page: Page = $state({
    kind: "links",
    state: { kind: "pending" },
    search: "",
    selected: [],
  });
  let outcome: Outcome = $state({ kind: "idle" });
  let copyFeedback: CopyFeedback = $state({ kind: "idle" });
  let copyAttempt = 0;
  function clearCopy() {
    copyAttempt++;
    copyFeedback = { kind: "idle" };
  }
  onDestroy(clearCopy);
  $effect(() => {
    if (copyFeedback.kind !== "success" && copyFeedback.kind !== "error")
      return;
    const timer = setTimeout(
      clearCopy,
      copyFeedback.kind === "success" ? 3000 : 5000,
    );
    return () => clearTimeout(timer);
  });
  let command: Command = $state({ kind: "none" });
  type Session =
    | { kind: "discovering" }
    | { kind: "failed"; error: Extract<Outcome, { kind: "error" }> }
    | { kind: "anonymous" }
    | { kind: "authenticated"; epoch: symbol };
  let session: Session = $state({ kind: "discovering" });
  let generation = 0;
  let tokenName = $state("Chrome extension");
  let tokenDays = $state(90);
  let tokens: Resource<readonly import("../generated").AccessTokenMetadata[]> =
    $state({ kind: "pending" });
  let issuedToken: import("../generated").IssuedAccessToken | undefined =
    $state();
  let tokenFeedback: Outcome = $state({ kind: "idle" });
  function clearTokenSecret() {
    issuedToken = undefined;
    tokenFeedback = { kind: "idle" };
  }
  onDestroy(() => {
    generation++;
    clearTokenSecret();
  });
  // A full-document navigation can freeze this component in the back/forward
  // cache without unmounting it. Clear synchronously before that snapshot.
  onMount(() => {
    const hide = () =>
      flushSync(() => {
        generation++;
        clearTokenSecret();
      });
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  });
  async function loadTokens() {
    if (page.kind !== "account") return;
    const request = generation;
    tokens = { kind: "pending" };
    const result = await api.accessTokens();
    if (request !== generation || page.kind !== "account") return;
    tokens = resultResource(result, (value) => value.items);
    if (
      result.kind === "failed" &&
      result.error.kind === "http" &&
      [401, 403].includes(result.error.status)
    )
      clearTokenSecret();
  }
  async function issueToken() {
    if (page.kind !== "account" || tokenFeedback.kind === "pending") return;
    const request = generation;
    issuedToken = undefined;
    tokenFeedback = { kind: "pending" };
    const result = await api.issueAccessToken({
      name: tokenName,
      expires_in_days: tokenDays,
    });
    if (request !== generation || page.kind !== "account") return;
    if (result.kind === "failed") {
      tokenFeedback = failureOutcome(result.error);
      return;
    }
    issuedToken = result.value;
    tokenFeedback = { kind: "idle" };
    await loadTokens();
  }
  async function revokeToken(id: number) {
    if (page.kind !== "account" || tokenFeedback.kind === "pending") return;
    const request = generation;
    tokenFeedback = { kind: "pending" };
    if (issuedToken?.metadata.id === id) issuedToken = undefined;
    const result = await api.revokeAccessToken(id);
    if (request !== generation || page.kind !== "account") return;
    tokenFeedback =
      result.kind === "ok"
        ? { kind: "success", message: "Access token revoked." }
        : failureOutcome(result.error);
    if (result.kind === "ok") await loadTokens();
  }
  async function copyToken() {
    if (!issuedToken || tokenFeedback.kind === "pending") return;
    const request = generation,
      token = issuedToken.token;
    tokenFeedback = { kind: "pending" };
    try {
      await copy(token);
      if (request === generation && issuedToken?.token === token)
        tokenFeedback = { kind: "success", message: "Token copied." };
    } catch {
      if (request === generation && issuedToken?.token === token)
        tokenFeedback = {
          kind: "error",
          reason: "network",
          message: "Token could not be copied. Select it and copy manually.",
        };
    }
  }
  let passkeyName = $state("");
  let passkeys: Resource<readonly { id: number; name: string }[]> = $state({
    kind: "pending",
  });
  let passkeyEdits: Record<number, string> = $state({});
  let passkeyFeedback: Outcome = $state({ kind: "idle" });
  async function loadPasskeys() {
    if (page.kind !== "account") return;
    const request = generation;
    passkeys = { kind: "pending" };
    const result = await api.passkeys();
    if (request !== generation || page.kind !== "account") return;
    passkeys = resultResource(result, (value) => value.items);
  }
  async function renamePasskey(id: number) {
    if (
      page.kind !== "account" ||
      passkeyFeedback.kind === "pending" ||
      passkeys.kind !== "ready"
    )
      return;
    const name =
      passkeyEdits[id] ??
      passkeys.value.find((key) => key.id === id)?.name ??
      "";
    const parsed = parsePasskeyName(name);
    if (parsed === undefined) {
      passkeyFeedback = {
        kind: "error",
        reason: "validation",
        message:
          "Enter a passkey name (1–80 characters, no control characters).",
      };
      return;
    }
    const request = generation;
    passkeyFeedback = { kind: "pending" };
    const result = await api.renamePasskey(id, { name: parsed });
    if (request !== generation || page.kind !== "account") return;
    if (result.kind === "failed") {
      passkeyFeedback = failureOutcome(result.error);
      return;
    }
    passkeyEdits = { ...passkeyEdits, [id]: result.value.name };
    passkeyFeedback = { kind: "success", message: "Passkey renamed." };
    await loadPasskeys();
  }
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
    abandonEnrollment();
    clearCopy();
    generation++;
    clearTokenSecret();
    tokens = { kind: "pending" };
    passkeyAttempt?.abort();
    passkeyAttempt = undefined;
    page = next;
    signInState = { kind: "idle" };
    command = { kind: "none" };
    outcome = { kind: "idle" };
  }
  function beginCommand(next: Exclude<Command, { kind: "none" }>) {
    abandonEnrollment();
    generation++;
    clearTokenSecret();
    clearCopy();
    command = next;
    outcome = { kind: "idle" };
  }
  async function loadLinks() {
    if (session.kind !== "authenticated") return;
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
      session = { kind: "anonymous" };
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
    abandonEnrollment();
    if (target === "links") await loadLinks();
    else if (target === "account") {
      clearTokenSecret();
      const request = ++generation;
      const result = await api.me();
      if (request !== generation) return;
      if (result.kind === "ok") {
        setPage({
          kind: "account",
          user: result.value,
          enrollment: { kind: "idle" },
          retention:
            result.value.retention_days === null
              ? ""
              : String(result.value.retention_days),
        });
        passkeyEdits = {};
        passkeyFeedback = { kind: "idle" };
        passkeyName = "";
        await loadPasskeys();
        await loadTokens();
      } else notify(result, "");
    }
  }
  async function start() {
    if (location.pathname !== "/") {
      setPage({ kind: "not-found" });
      return;
    }
    clearTokenSecret();
    const request = ++generation;
    session = { kind: "discovering" };
    const result = await api.me();
    if (request !== generation) return;
    if (result.kind === "ok") {
      session = { kind: "authenticated", epoch: Symbol("session") };
      await loadLinks();
    } else if (
      result.error.kind === "http" &&
      [401, 403].includes(result.error.status)
    ) {
      session = { kind: "anonymous" };
      setPage({ kind: "auth", mode: { kind: "magic", email: "" } });
    } else {
      session = { kind: "failed", error: failureOutcome(result.error) };
    }
  }
  onMount(() => {
    void start();
    return () => {
      generation++;
      clearTokenSecret();
      passkeyAttempt?.abort();
      passkeyAttempt = undefined;
      session = { kind: "anonymous" };
    };
  });
  async function authenticate() {
    if (page.kind !== "auth" || outcome.kind === "pending") return;
    const mode = page.mode;
    const request = generation;
    outcome = { kind: "pending" };
    if (mode.kind === "magic") {
      signInState = { kind: "sending" };
      const result = await api.magic({ email: mode.email });
      if (request !== generation) return;
      notify(result, result.kind === "ok" ? result.value.message : "");
      signInState =
        result.kind === "ok"
          ? { kind: "sent" }
          : { kind: "email-error", message: result.error.message };
    }
  }
  async function passkeyLogin() {
    if (
      enrollmentAttempt ||
      page.kind !== "auth" ||
      page.mode.kind !== "magic" ||
      outcome.kind === "pending"
    )
      return;
    const request = generation;
    outcome = { kind: "pending" };
    signInState = { kind: "passkey-pending" };
    const attempt = new AbortController();
    passkeyAttempt = attempt;
    const result = await authenticatePasskey(api, {
      signal: attempt.signal,
      onVerifying: () => {
        if (request === generation) signInState = { kind: "passkey-verifying" };
      },
    });
    if (passkeyAttempt === attempt) {
      passkeyAttempt = undefined;
      if (attempt.signal.aborted) {
        signInState = { kind: "passkey-cancelled" };
        outcome = { kind: "idle" };
      }
    }
    if (request !== generation) return;
    if (result.kind === "failed")
      signInState = { kind: "passkey-error", message: result.error.message };
    if (notify(result, "Signed in.")) {
      session = { kind: "authenticated", epoch: Symbol("session") };
      await loadLinks();
    }
  }
  function cancelPasskey() {
    if (signInState.kind !== "passkey-pending") return;
    generation++;
    clearTokenSecret();
    passkeyAttempt?.abort();
    // Wait for any options response to settle before allowing another attempt:
    // a late Set-Cookie must not overwrite the next ceremony's browser binding.
    outcome = { kind: "pending" };
    signInState = { kind: "passkey-cancelling" };
  }
  async function enroll() {
    if (
      session.kind !== "authenticated" ||
      enrollmentAttempt ||
      passkeyAttempt ||
      page.kind !== "account" ||
      page.enrollment.kind === "enrolling"
    )
      return;
    const name = parsePasskeyName(passkeyName);
    if (name === undefined) {
      page = {
        ...page,
        enrollment: {
          kind: "failed",
          message: "Enter a passkey name (1–80 characters).",
        },
      };
      return;
    }
    const request = generation;
    page = { ...page, enrollment: { kind: "enrolling" } };
    const owner = session.epoch;
    const attempt = {
      controller: new AbortController(),
      phase: "preparing" as "preparing" | "verifying",
    };
    enrollmentAttempt = attempt;
    const result = await enrollPasskey(api, name, {
      signal: attempt.controller.signal,
      onVerifying: () => {
        attempt.phase = "verifying";
      },
    });
    if (enrollmentAttempt === attempt) enrollmentAttempt = undefined;
    if (session.kind !== "authenticated" || session.epoch !== owner) return;
    if (request !== generation || page.kind !== "account") {
      // A cancelled command/logout can leave the same Account screen mounted.
      // Release its old progress without publishing stale success or failure.
      if (page.kind === "account" && page.enrollment.kind === "enrolling")
        page = { ...page, enrollment: { kind: "idle" } };
      return;
    }
    page = {
      ...page,
      enrollment:
        result.kind === "ok"
          ? { kind: "succeeded", message: "Passkey added to your account." }
          : { kind: "failed", message: result.error.message },
    };
    if (result.kind === "ok") {
      passkeyName = "";
      await loadPasskeys();
    }
  }
  async function logout() {
    abandonEnrollment();
    if (session.kind !== "authenticated") return;
    const owner = session.epoch;
    // Success owns the session; failure feedback still owns the initiating page.
    clearTokenSecret();
    const request = ++generation;
    outcome = { kind: "pending" };
    const result = await api.logout();
    if (session.kind !== "authenticated" || owner !== session.epoch) return;
    if (result.kind === "ok") {
      session = { kind: "anonymous" };
      setPage({ kind: "auth", mode: { kind: "magic", email: "" } });
    } else if (request === generation) notify(result, "");
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
    if (action === "edit" || action === "stats") {
      const code = link.addresses[0]?.short_code;
      const path =
        code && managementUrl(code, action === "edit" ? "edit" : "statistics");
      if (path) navigateTo(path);
    } else if (action === "copy") {
      const attempt = ++copyAttempt;
      copyFeedback = { kind: "pending", id };
      const address = link.addresses[0];
      if (!address) {
        copyFeedback = { kind: "error", id, message: "No address to copy." };
        return;
      }
      try {
        await copy(`https://${address.domain}/${address.short_code}`);
        if (request !== generation || attempt !== copyAttempt) return;
        copyFeedback = {
          kind: "success",
          id,
          message: "Short address copied.",
        };
      } catch {
        if (request !== generation || attempt !== copyAttempt) return;
        copyFeedback = {
          kind: "error",
          id,
          message: "Clipboard unavailable. Select and copy the short address.",
        };
      }
    } else if (action === "delete") beginCommand({ kind: "delete-link", id });
    else if (action === "toggle") {
      outcome = { kind: "pending" };
      const result = await api.patch(id, { enabled: !link.enabled });
      if (request !== generation) return;
      if (notify(result, "Link updated.")) await loadLinks();
    } else
      await loadAnalytics(
        id,
        link.title || `Link #${id}`,
        "events",
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
    const request = generation;
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
    if (request !== generation) return;
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
            ? [
                [source.destination, source.alias]
                  .map((cell) => `"${cell.replaceAll('"', '""')}"`)
                  .join(","),
              ]
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
                `Row ${rows[row.index]?.row ?? row.index + 1}: ${row.status === "created" ? "created" : row.error.message}`,
            )
            .join(" · "),
        }
      : {
          kind: "success",
          message: `Created ${created.length} links. Return to links to manage them.`,
        };
  }
  async function readFile(file: File) {
    if (page.kind !== "import") return;
    clearTokenSecret();
    const request = ++generation;
    outcome = { kind: "idle" };
    if (file.size > 1024 * 1024) {
      outcome = {
        kind: "error",
        message: "CSV exceeds the 1 MiB browser import limit.",
      };
      return;
    }
    try {
      const text = await file.text();
      if (request !== generation) return;
      if (page.kind === "import") page = { kind: "import", text };
    } catch {
      if (request !== generation) return;
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
        title: `${bulkActionLabels[value.action]} for ${value.ids.length} ${value.ids.length === 1 ? "link" : "links"}`,
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
              ? "Delete this link?"
              : value.kind === "bulk"
                ? `${bulkActionLabels[value.action]} ${value.ids.length} ${value.ids.length === 1 ? "link" : "links"}?`
                : "Confirm action?",
      description:
        value.kind === "signout"
          ? "This signs out all sessions. Your passkeys and links stay."
          : value.kind === "remove-password"
            ? "Anyone with the address will be able to open this link."
            : value.kind === "delete-link" ||
                (value.kind === "bulk" && value.action === "delete")
              ? "Deleted addresses remain reserved."
              : `Apply this change to the selected ${value.kind === "bulk" && value.ids.length === 1 ? "link" : "links"}.`,
    };
  }
  function commandValue(value: string) {
    if (command.kind === "bulk") command = { ...command, value };
  }
  async function confirmCommand() {
    if (command.kind === "none" || outcome.kind === "pending") return;
    const target = command;
    const owner = session.kind === "authenticated" ? session.epoch : null;
    const request = generation;
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
        if (request !== generation) return;
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
      if (
        request !== generation ||
        session.kind !== "authenticated" ||
        owner !== session.epoch
      )
        return;
      outcome = {
        kind: "error",
        reason: "validation",
        message: error instanceof Error ? error.message : "Invalid action.",
      };
      return;
    }
    // Revocation is authoritative for the same session even on a different screen.
    if (session.kind !== "authenticated" || owner !== session.epoch) return;
    if (target.kind === "signout" && result.kind === "ok") {
      session = { kind: "anonymous" };
      setPage({ kind: "auth", mode: { kind: "magic", email: "" } });
      return;
    }
    if (request !== generation) return;
    if (!notify(result, "Action completed.")) return;
    command = { kind: "none" };
    await loadLinks();
  }
</script>

{#if page.kind === "not-found"}
  <main class="app-shell">
    <PublicPage
      {appName}
      page={{ kind: "not-found" }}
      outcome={{ kind: "idle" }}
    />
  </main>
{:else if session.kind === "anonymous" && page.kind === "auth"}
  <AuthPanel
    {appName}
    mode={page.mode}
    state={signInState}
    {outcome}
    onchange={(mode) => {
      if (page.kind === "auth") page = { kind: "auth", mode };
    }}
    onsubmit={authenticate}
    onpasskey={passkeyLogin}
    oncancel={cancelPasskey}
  />
{:else}
  <AppShell
    {appName}
    section={section()}
    authenticated={session.kind === "authenticated"}
    onnav={navigate}
    onlogout={logout}
  >
    {#if command.kind !== "none"}<FocusedModal
        onclose={() => {
          if (outcome.kind !== "pending") {
            generation++;
            clearTokenSecret();
            command = { kind: "none" };
            outcome = { kind: "idle" };
          }
        }}
        ><ActionForm
          view={commandView(command)}
          {outcome}
          onchange={commandValue}
          onconfirm={confirmCommand}
          oncancel={() => {
            generation++;
            clearTokenSecret();
            command = { kind: "none" };
            outcome = { kind: "idle" };
          }}
        /></FocusedModal
      >{:else if page.kind !== "auth" && page.kind !== "editor" && page.kind !== "import" && page.kind !== "account"}<ResourceStatus
        state={outcome}
      />{/if}
    {#if session.kind === "discovering"}<ResourceStatus
        state={{ kind: "pending" }}
      />
    {:else if session.kind === "failed"}<ResourceStatus
        state={session.error}
        onretry={start}
      />
    {:else if page.kind === "links"}<Dashboard
        {copyFeedback}
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
        onselectall={(checked) => {
          if (page.kind !== "links" || page.state.kind !== "ready") return;
          const visible = filterLinks(
            page.state.value.map(linkRow),
            page.search,
          ).map((row) => row.id);
          page = {
            ...page,
            selected: checked
              ? [...new Set([...page.selected, ...visible])]
              : page.selected.filter((id) => !visible.includes(id)),
          };
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
            beginCommand({
              kind: "bulk",
              ids: page.selected,
              action,
              value: "",
            });
        }}
        onretry={loadLinks}
      />
    {:else if page.kind === "editor"}{#if command.kind === "none"}<FocusedModal
          onclose={loadLinks}
          ><LinkEditor
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
                  beginCommand({ kind: "remove-password", id: page.mode.id });
              }}>Remove existing password</button
            >{/if}</FocusedModal
        >{/if}
    {:else if page.kind === "import"}<FocusedModal onclose={loadLinks}
        ><BulkImport
          text={page.text}
          rows={parseBulk(page.text)}
          {outcome}
          onchange={(text) => {
            if (page.kind === "import") page = { kind: "import", text };
          }}
          onfile={readFile}
          onsubmit={importLinks}
          oncancel={loadLinks}
        /></FocusedModal
      >
    {:else if page.kind === "analytics"}<FocusedModal onclose={loadLinks} wide
        ><Analytics
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
        /></FocusedModal
      >
    {:else if page.kind === "account"}<AccountPanel
        accessTokens={{
          tokens,
          name: tokenName,
          days: tokenDays,
          issued: issuedToken,
          feedback: tokenFeedback,
          onname: (value) => (tokenName = value),
          ondays: (value) => (tokenDays = value),
          oncreate: issueToken,
          onrevoke: revokeToken,
          oncopy: copyToken,
          ondismiss: clearTokenSecret,
          onretry: loadTokens,
        }}
        enrollmentBusy={enrollmentAttempt !== undefined}
        {passkeyName}
        {passkeys}
        {passkeyEdits}
        {passkeyFeedback}
        onpasskeyname={(name) => (passkeyName = name)}
        onpasskeyedit={(id, name) =>
          (passkeyEdits = { ...passkeyEdits, [id]: name })}
        onpasskeyrename={renamePasskey}
        onpasskeyretry={loadPasskeys}
        email={page.user.email}
        retention={page.retention}
        enrollment={page.enrollment}
        {outcome}
        onretention={(retention) => {
          if (page.kind === "account") page = { ...page, retention };
        }}
        onsave={saveAccount}
        onenroll={enroll}
        onsignout={() => beginCommand({ kind: "signout" })}
        onlogout={logout}
      />
    {:else}<PublicPage
        {appName}
        page={{ kind: "not-found" }}
        outcome={{ kind: "idle" }}
      />{/if}
  </AppShell>
{/if}
