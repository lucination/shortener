<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import SignInPage from "../SignInPage.svelte";
  import type { SignInState } from "../sign-in";
  import { appName as configuredName } from "../adapters/branding";
  let {
    appName = configuredName,
    initialState = { kind: "idle" },
    initialEmail = "",
    emailResult = "sent",
    passkeyResult = "cancelled",
  }: {
    appName?: string;
    initialState?: SignInState;
    initialEmail?: string;
    emailResult?: "sent" | "error";
    passkeyResult?: "cancelled" | "error";
  } = $props();
  let email = $state(untrack(() => initialEmail));
  let current = $state<SignInState>(untrack(() => initialState));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
  };
  onDestroy(clear);
  function submit() {
    clear();
    const retry = current.kind === "email-error";
    current = { kind: "sending" };
    timer = setTimeout(() => {
      current =
        emailResult === "error" && !retry
          ? {
              kind: "email-error",
              message: "Unable to request a sign-in link. Try again.",
            }
          : { kind: "sent" };
    }, 600);
  }
  function passkey() {
    clear();
    current = { kind: "passkey-pending" };
    timer = setTimeout(() => {
      current =
        passkeyResult === "error"
          ? {
              kind: "passkey-error",
              message:
                "Unable to sign in with a passkey. Try again or use an email link.",
            }
          : { kind: "passkey-cancelled" };
    }, 1800);
  }
</script>

<SignInPage
  {appName}
  {email}
  state={current}
  onchange={(value) => {
    clear();
    email = value;
    current = { kind: "idle" };
  }}
  onsubmit={submit}
  onpasskey={passkey}
  oncancel={() => {
    clear();
    current = { kind: "passkey-cancelled" };
  }}
/>
