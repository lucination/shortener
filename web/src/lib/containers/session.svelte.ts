import type { Outcome } from "../view-models";
import type { Result } from "../adapters/api";

export type Session =
  | { kind: "discovering" }
  | { kind: "failed"; error: Extract<Outcome, { kind: "error" }> }
  | { kind: "anonymous" }
  | { kind: "authenticated"; epoch: symbol };

/**
 * User session authority. Each authentication mints a fresh epoch so held
 * sign-out, revocation and enrollment completions can prove they still belong
 * to the session that started them.
 */
export class SessionState {
  value: Session = $state({ kind: "discovering" });
  get authenticated(): boolean {
    return this.value.kind === "authenticated";
  }
  /** The current epoch, or null when no user session is authenticated. */
  get epoch(): symbol | null {
    return this.value.kind === "authenticated" ? this.value.epoch : null;
  }
  owns(epoch: symbol | null): boolean {
    return epoch !== null && this.epoch === epoch;
  }
  discover() {
    this.value = { kind: "discovering" };
  }
  authenticate() {
    this.value = { kind: "authenticated", epoch: Symbol("session") };
  }
  signOut() {
    this.value = { kind: "anonymous" };
  }
  fail(error: Extract<Outcome, { kind: "error" }>) {
    this.value = { kind: "failed", error };
  }
}

/** 401/403 means the user session authority is gone. */
export const unauthorized = (result: Result<unknown>): boolean =>
  result.kind === "failed" &&
  result.error.kind === "http" &&
  [401, 403].includes(result.error.status);
