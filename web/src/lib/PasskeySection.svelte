<script lang="ts">
  import type { EnrollmentState } from "./view-models";
  let {
    state,
    onenroll = () => {},
  }: { state: EnrollmentState; onenroll?: () => void } = $props();
</script>

<section data-testid="passkey-section" class="box-frame stack">
  <h2>Passkeys</h2>
  <p>
    Enroll this device or a security key for future sign-ins. Existing passkeys
    are preserved when you sign out everywhere.
  </p>
  <div class="toolbar">
    <button onclick={onenroll} disabled={state.kind === "enrolling"}
      >{state.kind === "enrolling" ? "Adding passkey…" : "Add passkey"}</button
    >
    {#if state.kind === "enrolling"}<p data-testid="enrollment-feedback">
        Complete the request on your device.
      </p>{:else if state.kind === "succeeded"}<p
        data-testid="enrollment-feedback"
      >
        {state.message}
      </p>{:else if state.kind === "failed"}<p
        data-testid="enrollment-feedback"
        class="error"
      >
        {state.message}
      </p>{/if}
  </div>
</section>
