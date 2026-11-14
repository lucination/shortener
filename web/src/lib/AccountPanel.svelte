<script lang="ts">
  import type { Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    email,
    retention,
    outcome,
    onretention = () => {},
    onsave = () => {},
    onenroll = () => {},
    onsignout = () => {},
    onlogout = () => {},
  }: {
    email: string;
    retention: string;
    outcome: Outcome;
    onretention?: (value: string) => void;
    onsave?: () => void;
    onenroll?: () => void;
    onsignout?: () => void;
    onlogout?: () => void;
  } = $props();
</script>

<section class="stack">
  <p class="muted">WORKSPACE / ACCOUNT</p>
  <h1>Account</h1>
  <div class="box-frame stack">
    <h2>{email}</h2>
    <p class="muted">Your email address is managed by your administrator.</p>
    <hr class="rule" />
    <h2>Passkeys</h2>
    <p>
      Enroll this device or a security key for future sign-ins. Existing
      passkeys are preserved when you sign out everywhere.
    </p>
    <div>
      <button onclick={onenroll} disabled={outcome.kind === "pending"}
        >Add passkey</button
      >
    </div>
  </div>
  <form
    class="box-frame stack"
    onsubmit={(event) => {
      event.preventDefault();
      onsave();
    }}
  >
    <h2>Raw click data</h2>
    <label class="field max-w-md"
      >Default retention (days)<input
        type="number"
        min="1"
        placeholder="Use server default (90 days)"
        value={retention}
        oninput={(event) => onretention(event.currentTarget.value)}
      /></label
    >
    <p class="muted">
      Link settings override this default. Shorter retention takes effect at the
      next cleanup. Daily aggregates remain.
    </p>
    <div>
      <button disabled={outcome.kind === "pending"}>Save retention</button>
    </div>
  </form>
  <ResourceStatus state={outcome} />
  <div class="box-frame stack">
    <h2>Sessions</h2>
    <p>
      Revoke every signed-in session without deleting your passkeys or links.
    </p>
    <div class="toolbar">
      <button onclick={onsignout} disabled={outcome.kind === "pending"}
        >Sign out everywhere</button
      ><button onclick={onlogout}>Sign out this session</button>
    </div>
  </div>
</section>
