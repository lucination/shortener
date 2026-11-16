<script lang="ts">
  import type { Outcome, EnrollmentState } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  import PasskeySection from "./PasskeySection.svelte";
  let {
    email,
    retention,
    outcome,
    enrollment = { kind: "idle" },
    onretention = () => {},
    onsave = () => {},
    onenroll = () => {},
    onsignout = () => {},
    onlogout = () => {},
  }: {
    email: string;
    retention: string;
    outcome: Outcome;
    enrollment?: EnrollmentState;
    onretention?: (value: string) => void;
    onsave?: () => void;
    onenroll?: () => void;
    onsignout?: () => void;
    onlogout?: () => void;
  } = $props();
</script>

<section class="stack">
  <h1>Account</h1>
  <div class="box-frame stack">
    <h2>Email address</h2>
    <p>{email}</p>
    <p class="muted">Your email address is managed by your administrator.</p>
  </div>
  <PasskeySection state={enrollment} {onenroll} />
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
