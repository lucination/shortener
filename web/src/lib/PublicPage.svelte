<script lang="ts">
  import { DEFAULT_APP_NAME } from "./app-name";
  import type { PublicView, Outcome } from "./view-models";
  import ResourceStatus from "./ResourceStatus.svelte";
  let {
    appName = DEFAULT_APP_NAME,
    page,
    outcome,
    onpassword = () => {},
    oncontinue = () => {},
  }: {
    appName?: string;
    page: PublicView;
    outcome: Outcome;
    onpassword?: (value: string) => void;
    oncontinue?: () => void;
  } = $props();
</script>

<section class="public-page stack box-frame">
  <strong>{appName}</strong>
  {#if page.kind === "not-found"}<h1>Link not found.</h1>
    <p>
      This address is unavailable. Check the address or ask the person who
      shared it.
    </p>
    <a href="/">Go to your workspace</a>
  {:else if page.kind === "password"}<h1>Protected link</h1>
    <p>Enter the link password before viewing its destination.</p>
    <form
      data-testid="password-form"
      class="box-frame stack"
      onsubmit={(event) => {
        event.preventDefault();
        oncontinue();
      }}
    >
      <label class="field"
        >Link password<input
          type="password"
          required
          value={page.password}
          oninput={(event) => onpassword(event.currentTarget.value)}
        /></label
      ><button class="btn-primary" disabled={outcome.kind === "pending"}
        >Unlock link</button
      >
    </form>
  {:else}<h1>{page.title || "Continue to destination"}</h1>
    {#if page.description}<p>{page.description}</p>{/if}
    <div class="box-frame stack">
      <h2>Destination</h2>
      <p class="break">{page.destination}</p>
      <button
        class="btn-primary"
        disabled={outcome.kind === "pending"}
        onclick={oncontinue}>Continue</button
      >
    </div>
    <p class="muted">
      Continue only if you trust this destination. There is no automatic
      countdown.
    </p>{/if}<ResourceStatus state={outcome} />
</section>
