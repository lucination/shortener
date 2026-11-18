import type { Outcome } from "../view-models";
import type { Result } from "../adapters/api";
import { failureOutcome } from "../resource";

/**
 * The single in-flight action outcome of the current screen (form, command or
 * page section). Its pending state is the re-entrancy guard for that screen.
 */
export class PageOutcome {
  value: Outcome = $state({ kind: "idle" });
  get pending(): boolean {
    return this.value.kind === "pending";
  }
  begin() {
    this.value = { kind: "pending" };
  }
  reset() {
    this.value = { kind: "idle" };
  }
  fail(message: string, reason?: "validation" | "network") {
    this.value = reason
      ? { kind: "error", reason, message }
      : { kind: "error", message };
  }
  /** Publishes the result and reports whether it succeeded. */
  notify<T>(result: Result<T>, message: string): boolean {
    this.value =
      result.kind === "ok"
        ? { kind: "success", message }
        : failureOutcome(result.error);
    return result.kind === "ok";
  }
}
