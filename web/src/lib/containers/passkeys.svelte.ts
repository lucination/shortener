import type { Api } from "../adapters/api";
import { enrollPasskey } from "../adapters/passkeys";
import { parsePasskeyName } from "../passkey-name";
import { failureOutcome, resultResource } from "../resource";
import type { EnrollmentState, Outcome, Resource } from "../view-models";
import type { Generation } from "./generation";
import type { SessionState } from "./session.svelte";

type EnrollmentAttempt = {
  controller: AbortController;
  phase: "preparing" | "verifying";
};

/**
 * Account passkey list, rename and enrollment. Enrollment owns one
 * cancellable pre-verification attempt; an abandoned attempt is retained
 * (keeping enrollment busy) until its options/cookie/credential work settles,
 * so no replacement can steal the service-global WebAuthn owner. Only the
 * "preparing" phase is aborted: transmitted verification is authoritative.
 */
export class PasskeysController {
  name = $state("");
  keys: Resource<readonly { id: number; name: string }[]> = $state({
    kind: "pending",
  });
  edits: Record<number, string> = $state({});
  feedback: Outcome = $state({ kind: "idle" });
  enrollment: EnrollmentState = $state({ kind: "idle" });
  #attempt: EnrollmentAttempt | undefined = $state.raw();
  readonly #api: Api;
  readonly #generation: Generation;
  readonly #session: SessionState;
  readonly #active: () => boolean;
  readonly #loginBusy: () => boolean;
  constructor(deps: {
    api: Api;
    generation: Generation;
    session: SessionState;
    active: () => boolean;
    loginBusy: () => boolean;
  }) {
    this.#api = deps.api;
    this.#generation = deps.generation;
    this.#session = deps.session;
    this.#active = deps.active;
    this.#loginBusy = deps.loginBusy;
  }
  get enrollmentBusy(): boolean {
    return this.#attempt !== undefined;
  }
  /** Fresh Account screen: forget per-screen inputs and feedback. */
  open() {
    this.enrollment = { kind: "idle" };
    this.edits = {};
    this.feedback = { kind: "idle" };
    this.name = "";
  }
  /** Leaving the screen/session: abort enrollment only before verification. */
  abandon() {
    if (this.#attempt?.phase === "preparing") this.#attempt.controller.abort();
  }
  edit(id: number, name: string) {
    this.edits = { ...this.edits, [id]: name };
  }
  async load() {
    if (!this.#active()) return;
    const request = this.#generation.current;
    this.keys = { kind: "pending" };
    const result = await this.#api.passkeys();
    if (!this.#generation.owns(request) || !this.#active()) return;
    this.keys = resultResource(result, (value) => value.items);
  }
  async rename(id: number) {
    if (
      !this.#active() ||
      this.feedback.kind === "pending" ||
      this.keys.kind !== "ready"
    )
      return;
    const parsed = parsePasskeyName(
      this.edits[id] ??
        this.keys.value.find((key) => key.id === id)?.name ??
        "",
    );
    if (parsed === undefined) {
      this.feedback = {
        kind: "error",
        reason: "validation",
        message:
          "Enter a passkey name (1–80 characters, no control characters).",
      };
      return;
    }
    const request = this.#generation.current;
    this.feedback = { kind: "pending" };
    const result = await this.#api.renamePasskey(id, { name: parsed });
    if (!this.#generation.owns(request) || !this.#active()) return;
    if (result.kind === "failed") {
      this.feedback = failureOutcome(result.error);
      return;
    }
    this.edits = { ...this.edits, [id]: result.value.name };
    this.feedback = { kind: "success", message: "Passkey renamed." };
    await this.load();
  }
  async enroll() {
    const owner = this.#session.epoch;
    if (
      owner === null ||
      this.#attempt ||
      this.#loginBusy() ||
      !this.#active() ||
      this.enrollment.kind === "enrolling"
    )
      return;
    const name = parsePasskeyName(this.name);
    if (name === undefined) {
      this.enrollment = {
        kind: "failed",
        message: "Enter a passkey name (1–80 characters).",
      };
      return;
    }
    const request = this.#generation.current;
    this.enrollment = { kind: "enrolling" };
    const attempt: EnrollmentAttempt = {
      controller: new AbortController(),
      phase: "preparing",
    };
    this.#attempt = attempt;
    const result = await enrollPasskey(this.#api, name, {
      signal: attempt.controller.signal,
      onVerifying: () => {
        attempt.phase = "verifying";
      },
    });
    if (this.#attempt === attempt) this.#attempt = undefined;
    if (!this.#session.owns(owner)) return;
    if (!this.#generation.owns(request) || !this.#active()) {
      // A cancelled command/logout can leave the same Account screen mounted.
      // Release its old progress without publishing stale success or failure.
      if (this.#active() && this.enrollment.kind === "enrolling")
        this.enrollment = { kind: "idle" };
      return;
    }
    this.enrollment =
      result.kind === "ok"
        ? { kind: "succeeded", message: "Passkey added to your account." }
        : { kind: "failed", message: result.error.message };
    if (result.kind === "ok") {
      this.name = "";
      await this.load();
    }
  }
}
