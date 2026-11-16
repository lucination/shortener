<script lang="ts">
  import { Link, KeyRound } from "@lucide/svelte";
  import type { SignInState } from "./sign-in";
  import "./styles/presentation.css";
  let {
    appName,
    email,
    state,
    onchange = () => {},
    onsubmit = () => {},
    onpasskey = () => {},
    oncancel = () => {},
  }: {
    appName: string;
    email: string;
    state: SignInState;
    onchange?: (email: string) => void;
    onsubmit?: () => void;
    onpasskey?: () => void;
    oncancel?: () => void;
  } = $props();
  const pending = $derived(
    state.kind === "sending" ||
      state.kind === "passkey-pending" ||
      state.kind === "passkey-verifying" ||
      state.kind === "passkey-cancelling",
  );
</script>

<svelte:head><title>Sign in · {appName}</title></svelte:head>
<div class="design-language si-page" data-direction="precision">
  <header class="dl-appbar">
    <div class="dl-brand">
      <span class="dl-mark"><Link size={14} /></span>{appName}
    </div>
  </header>
  <main class="si-main">
    <section class="si-panel">
      <h1>Sign in</h1>
      <p class="si-intro">Enter your email to receive a sign-in link.</p>
      <form
        data-testid="auth-form"
        onsubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          onsubmit();
        }}
      >
        <label
          >Email<input
            type="email"
            autocomplete="email"
            required
            value={email}
            placeholder="you@example.org"
            disabled={pending}
            oninput={(event) => onchange(event.currentTarget.value)}
          /></label
        >
        {#if state.kind === "sent"}
          <p class="si-notice">
            If this email belongs to an account, a sign-in link is on its way.
            Check your inbox.
          </p>
        {:else if state.kind === "email-error" || state.kind === "passkey-error"}
          <p class="si-notice si-error">{state.message}</p>
        {:else if state.kind === "passkey-cancelled" || state.kind === "passkey-cancelling"}
          <p class="si-notice">
            Passkey sign-in was cancelled. Try again or use an email link.
          </p>
        {/if}
        <button class="dl-primary" type="submit" disabled={pending}
          >{state.kind === "sending"
            ? "Sending link…"
            : state.kind === "email-error"
              ? "Try again"
              : state.kind === "sent"
                ? "Send another link"
                : "Send sign-in link"}</button
        >
      </form>
      <div class="si-passkey">
        <div class="si-divider"><span>or</span></div>
        <button type="button" onclick={onpasskey} disabled={pending}
          ><KeyRound size={14} />{state.kind === "passkey-pending"
            ? "Waiting for passkey…"
            : state.kind === "passkey-verifying"
              ? "Signing in…"
              : state.kind === "passkey-cancelling"
                ? "Cancelling passkey…"
                : "Sign in with passkey"}</button
        >
        {#if state.kind === "passkey-pending"}<button
            type="button"
            class="si-cancel"
            onclick={oncancel}>Cancel</button
          >{/if}
      </div>
    </section>
  </main>
</div>

<style>
  .si-page {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .si-main {
    flex: 1;
    display: grid;
    place-items: center;
    padding: 40px 16px 96px;
  }
  .si-panel {
    width: min(360px, 100%);
    padding: 24px;
    border: 1px solid var(--dl-line);
    border-radius: var(--dl-radius);
    background: var(--dl-panel);
  }
  :global(#storybook-root .design-language.si-page h1),
  .si-page h1 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.4px;
    line-height: 1.5;
  }
  :global(#storybook-root .design-language .si-intro),
  .si-intro {
    margin-top: 4px;
    color: var(--dl-muted);
    font-size: 12px;
  }
  form {
    display: grid;
    gap: 12px;
    margin-top: 24px;
  }
  input {
    width: 100%;
  }
  .si-passkey {
    display: grid;
    gap: 12px;
    margin-top: 12px;
  }
  .si-notice {
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .si-error {
    color: var(--dl-danger);
  }
  .si-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--dl-muted);
    font-size: 11px;
  }
  .si-divider::before,
  .si-divider::after {
    content: "";
    height: 1px;
    flex: 1;
    background: var(--dl-faint);
  }
  :global(#storybook-root .design-language .si-cancel),
  .si-page .si-cancel {
    background: transparent;
    border-color: transparent;
    color: var(--dl-muted);
  }
  @media (max-height: 520px) {
    .si-main {
      padding-block: 24px;
    }
  }
</style>
