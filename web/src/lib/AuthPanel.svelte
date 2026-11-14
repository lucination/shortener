<script lang="ts">
  import type { AuthMode, Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    mode,
    outcome,
    onchange = () => {},
    onsubmit = () => {},
    onpasskey = () => {},
  }: {
    mode: AuthMode;
    outcome: Outcome;
    onchange?: (mode: AuthMode) => void;
    onsubmit?: () => void;
    onpasskey?: () => void;
  } = $props();
</script>

<section class="stack max-w-2xl mx-auto">
  <p class="muted">
    Shortener / {mode.kind === "admin" ? "ADMINISTRATION" : "YOUR WORKSPACE"}
  </p>
  <h1>{mode.kind === "admin" ? "Admin sign in" : "A shorter way in."}</h1>
  <hr class="rule" />
  <form
    data-testid="auth-form"
    class="box-frame stack"
    onsubmit={(event) => {
      event.preventDefault();
      onsubmit();
    }}
  >
    {#if mode.kind === "magic"}<h2>Sign in by email</h2>
      <p>
        Use the email address your administrator added. We will send a one-time
        sign-in link.
      </p>
      <label class="field"
        >Email address<input
          type="email"
          autocomplete="email"
          required
          value={mode.email}
          placeholder="you@example.org"
          oninput={(event) =>
            onchange({ kind: "magic", email: event.currentTarget.value })}
        /></label
      >{:else}<h2>Administrator token</h2>
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
      >{/if}<ResourceStatus state={outcome} onretry={onsubmit} /><button
      class="btn-primary"
      disabled={outcome.kind === "pending"}
      >{outcome.kind === "pending"
        ? "Signing in…"
        : mode.kind === "magic"
          ? "Send sign-in link"
          : "Sign in"}</button
    >{#if mode.kind === "magic"}<button
        type="button"
        onclick={onpasskey}
        disabled={outcome.kind === "pending"}>Use a passkey</button
      >{/if}
  </form>
  {#if mode.kind === "magic"}
    <p class="muted">
      No public signup. No passwords to remember. Sign-in links expire and can
      be used once.
    </p>
  {/if}
</section>
