<script lang="ts">
  import { Copy, KeyRound, Trash2 } from "@lucide/svelte";
  import type { AccessTokenMetadata, IssuedAccessToken } from "./generated";
  import type { Resource, Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    tokens = { kind: "ready", value: [] },
    name = "Chrome extension",
    days = 90,
    issued,
    feedback = { kind: "idle" },
    onname = () => {},
    ondays = () => {},
    oncreate = () => {},
    onrevoke = () => {},
    oncopy = () => {},
    ondismiss = () => {},
    onretry = () => {},
  }: {
    tokens?: Resource<readonly AccessTokenMetadata[]>;
    name?: string;
    days?: number;
    issued?: IssuedAccessToken;
    feedback?: Outcome;
    onname?: (value: string) => void;
    ondays?: (value: number) => void;
    oncreate?: () => void;
    onrevoke?: (id: number) => void;
    oncopy?: () => void;
    ondismiss?: () => void;
    onretry?: () => void;
  } = $props();
  const date = (value: string) => new Date(value).toLocaleString();
</script>

<section class="box-frame stack" data-testid="access-token-section">
  <h2 class="toolbar"><KeyRound size={14} />Access tokens</h2>
  <p>
    Create-only credentials for browser extensions and other tools. Tokens can
    only create links, not read or change your account or existing links.
  </p>
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      oncreate();
    }}
  >
    <div class="toolbar token-form">
      <label class="field"
        >Token name<input
          value={name}
          oninput={(event) => onname(event.currentTarget.value)}
          disabled={feedback.kind === "pending"}
          placeholder="Chrome extension"
        /></label
      >
      <label class="field"
        >Expires in<select
          value={days}
          onchange={(event) => ondays(Number(event.currentTarget.value))}
          disabled={feedback.kind === "pending"}
        >
          <option value={30}>30 days</option><option value={90}>90 days</option
          ><option value={180}>180 days</option><option value={365}
            >365 days</option
          >
        </select></label
      >
      <button class="btn-primary" disabled={feedback.kind === "pending"}
        >Create access token</button
      >
    </div>
  </form>
  {#if issued}<div class="stack token-reveal">
      <p>
        <strong>Copy this token now.</strong> It will not be shown again after you
        leave this page.
      </p>
      <label class="field"
        >New access token<input
          readonly
          value={issued.token}
          autocomplete="off"
          spellcheck="false"
        /></label
      >
      <div class="toolbar">
        <button
          class="with-icon"
          onclick={oncopy}
          disabled={feedback.kind === "pending"}
          ><Copy size={14} />Copy token</button
        ><button onclick={ondismiss}>Done</button>
      </div>
    </div>{/if}
  <ResourceStatus state={feedback} />
  <ResourceStatus state={tokens} {onretry} />
  {#if tokens.kind === "ready"}
    {#if !tokens.value.length}<p class="muted">No access tokens.</p>{/if}
    {#each tokens.value as token (token.id)}<div class="token-row stack">
        <div class="toolbar spread">
          <strong>{token.name}</strong><button
            class="with-icon"
            aria-label={`Revoke ${token.name}`}
            title={`Revoke ${token.name}`}
            onclick={() => onrevoke(token.id)}
            disabled={feedback.kind === "pending"}
            ><Trash2 size={14} />Revoke</button
          >
        </div>
        <p class="muted">{token.prefix}… · Create links only</p>
        <p class="muted">
          Created {date(token.created_at)} · Expires {date(token.expires_at)}
        </p>
        <p class="muted">
          Last used: {token.last_used_at ? date(token.last_used_at) : "Never"}
        </p>
      </div>{/each}
  {/if}
  <p class="muted">
    Sign out does not revoke access tokens. Revoke a token here to stop its use.
  </p>
</section>

<style>
  .token-form {
    align-items: flex-end;
  }
  .token-form .field:first-child {
    width: min(320px, 100%);
  }
  .token-row {
    border-top: 1px solid var(--dl-faint);
    padding-top: 12px;
    gap: 4px;
    overflow-wrap: anywhere;
  }
  .token-reveal {
    border: 1px solid var(--dl-line);
    border-radius: 4px;
    padding: 12px;
  }
</style>
