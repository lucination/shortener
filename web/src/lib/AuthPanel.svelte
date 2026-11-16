<script lang="ts">
  import { DEFAULT_APP_NAME } from "./app-name";
  import type { AuthMode, Outcome } from "./view-models";
  import SignInPage from "./SignInPage.svelte";
  import type { SignInState } from "./sign-in";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    appName = DEFAULT_APP_NAME,
    state = { kind: "idle" },
    mode,
    outcome,
    onchange = () => {},
    onsubmit = () => {},
    onpasskey = () => {},
    oncancel = () => {},
  }: {
    appName?: string;
    state?: SignInState;
    mode: AuthMode;
    outcome: Outcome;
    onchange?: (mode: AuthMode) => void;
    onsubmit?: () => void;
    onpasskey?: () => void;
    oncancel?: () => void;
  } = $props();
</script>

{#if mode.kind === "magic"}
  <SignInPage
    {appName}
    email={mode.email}
    {state}
    onchange={(email) => onchange({ kind: "magic", email })}
    {onsubmit}
    {onpasskey}
    {oncancel}
  />
{:else}
  <section class="stack max-w-2xl mx-auto">
    <p class="muted">{appName} / ADMINISTRATION</p>
    <h1>Admin sign in</h1>
    <hr class="rule" />
    <form
      data-testid="auth-form"
      class="box-frame stack"
      onsubmit={(event) => {
        event.preventDefault();
        onsubmit();
      }}
    >
      <h2>Administrator token</h2>
      <p>
        Enter the configured admin token. It is sent only to this server and is
        never stored in browser storage.
      </p>
      <label class="field"
        >Admin token<input
          type="password"
          autocomplete="off"
          required
          value={mode.token}
          oninput={(event) =>
            onchange({ kind: "admin", token: event.currentTarget.value })}
        /></label
      >
      <ResourceStatus state={outcome} onretry={onsubmit} />
      <button class="btn-primary" disabled={outcome.kind === "pending"}
        >{outcome.kind === "pending" ? "Signing in…" : "Sign in"}</button
      >
    </form>
  </section>
{/if}
