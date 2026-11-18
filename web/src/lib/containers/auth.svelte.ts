import type { Api } from "../adapters/api";
import { authenticatePasskey } from "../adapters/passkeys";
import type { SignInState } from "../sign-in";
import type { AuthMode } from "../view-models";
import type { Generation } from "./generation";
import type { PageOutcome } from "./outcome.svelte";

/**
 * User sign-in: magic link and usernameless passkey login. Cancelling a
 * passkey login holds resubmission (outcome stays pending) until the
 * outstanding options request settles, so a late browser-binding cookie can
 * never overwrite the next ceremony; the settled attempt then reports
 * "cancelled" and releases the form.
 */
export class AuthController {
  state: SignInState = $state({ kind: "idle" });
  mode: AuthMode = $state({ kind: "magic", email: "" });
  #attempt: AbortController | undefined;
  readonly #api: Api;
  readonly #generation: Generation;
  readonly #outcome: PageOutcome;
  readonly #active: () => boolean;
  readonly #enrollmentBusy: () => boolean;
  readonly #signedIn: () => Promise<void>;
  constructor(deps: {
    api: Api;
    generation: Generation;
    outcome: PageOutcome;
    active: () => boolean;
    enrollmentBusy: () => boolean;
    signedIn: () => Promise<void>;
  }) {
    this.#api = deps.api;
    this.#generation = deps.generation;
    this.#outcome = deps.outcome;
    this.#active = deps.active;
    this.#enrollmentBusy = deps.enrollmentBusy;
    this.#signedIn = deps.signedIn;
  }
  get loginBusy(): boolean {
    return this.#attempt !== undefined;
  }
  /** The sign-in screen's mode, or undefined when it is not shown. */
  #mode(): AuthMode | undefined {
    return this.#active() ? this.mode : undefined;
  }
  /** A freshly shown sign-in screen starts with an empty email. */
  open() {
    this.mode = { kind: "magic", email: "" };
  }
  setMode(mode: AuthMode) {
    if (this.#active()) this.mode = mode;
  }
  /** Screen replacement or unmount: abort any login ceremony. */
  reset() {
    this.#attempt?.abort();
    this.#attempt = undefined;
    this.state = { kind: "idle" };
  }
  async sendMagicLink() {
    const mode = this.#mode();
    if (!mode || this.#outcome.pending) return;
    const request = this.#generation.current;
    this.#outcome.begin();
    if (mode.kind === "magic") {
      this.state = { kind: "sending" };
      const result = await this.#api.magic({ email: mode.email });
      if (!this.#generation.owns(request)) return;
      this.#outcome.notify(
        result,
        result.kind === "ok" ? result.value.message : "",
      );
      this.state =
        result.kind === "ok"
          ? { kind: "sent" }
          : { kind: "email-error", message: result.error.message };
    }
  }
  async passkeyLogin() {
    if (
      this.#enrollmentBusy() ||
      this.#mode()?.kind !== "magic" ||
      this.#outcome.pending
    )
      return;
    const request = this.#generation.current;
    this.#outcome.begin();
    this.state = { kind: "passkey-pending" };
    const attempt = new AbortController();
    this.#attempt = attempt;
    const result = await authenticatePasskey(this.#api, {
      signal: attempt.signal,
      onVerifying: () => {
        if (this.#generation.owns(request))
          this.state = { kind: "passkey-verifying" };
      },
    });
    if (this.#attempt === attempt) {
      this.#attempt = undefined;
      if (attempt.signal.aborted) {
        this.state = { kind: "passkey-cancelled" };
        this.#outcome.reset();
      }
    }
    if (!this.#generation.owns(request)) return;
    if (result.kind === "failed")
      this.state = { kind: "passkey-error", message: result.error.message };
    if (this.#outcome.notify(result, "Signed in.")) await this.#signedIn();
  }
  cancelPasskey() {
    if (this.state.kind !== "passkey-pending") return;
    this.#generation.advance();
    this.#attempt?.abort();
    // Wait for any options response to settle before allowing another attempt:
    // a late Set-Cookie must not overwrite the next ceremony's browser binding.
    this.#outcome.begin();
    this.state = { kind: "passkey-cancelling" };
  }
}
