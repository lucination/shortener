<script lang="ts">
  import type { EnrollmentState, Resource, Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    state,
    onenroll = () => {},
    enrollmentBusy = false,
    name = "",
    keys = { kind: "ready", value: [] },
    edits = {},
    feedback = { kind: "idle" },
    onname = () => {},
    onedit = () => {},
    onrename = () => {},
    onretry = () => {},
  }: {
    state: EnrollmentState;
    onenroll?: () => void;
    enrollmentBusy?: boolean;
    name?: string;
    keys?: Resource<readonly { id: number; name: string }[]>;
    edits?: Readonly<Record<number, string>>;
    feedback?: Outcome;
    onname?: (name: string) => void;
    onedit?: (id: number, name: string) => void;
    onrename?: (id: number) => void;
    onretry?: () => void;
  } = $props();
</script>

<section data-testid="passkey-section" class="box-frame stack">
  <h2>Passkeys</h2>
  <p>
    Enroll this device or a security key for future sign-ins. Existing passkeys
    are preserved when you sign out everywhere.
  </p>
  <ResourceStatus state={keys} {onretry} />
  {#if keys.kind === "ready"}
    {#if !keys.value.length}<p class="muted">No passkeys registered.</p>{/if}
    {#each keys.value as key (key.id)}<form
        class="toolbar passkey-row"
        onsubmit={(event) => {
          event.preventDefault();
          onrename(key.id);
        }}
      >
        <label class="field"
          >Passkey name<input
            value={edits[key.id] ?? key.name}
            disabled={feedback.kind === "pending"}
            oninput={(event) => onedit(key.id, event.currentTarget.value)}
          /></label
        >
        <button disabled={feedback.kind === "pending"}>Rename</button>
      </form>{/each}
  {/if}
  <ResourceStatus state={feedback} />
  <label class="field max-w-md"
    >New passkey name<input
      placeholder="For example, laptop or security key"
      value={name}
      disabled={enrollmentBusy || state.kind === "enrolling"}
      oninput={(event) => onname(event.currentTarget.value)}
    /></label
  >
  <div class="toolbar">
    <button
      onclick={onenroll}
      disabled={enrollmentBusy || state.kind === "enrolling"}
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
