import type { Notice } from "../view-models";

export const toastDurations = { success: 3000, error: 5000 } as const;

/**
 * Owns the one transient quick-action notice (copy, toggle, delete, bulk and
 * save results). Only the newest attempt may publish; any newer notice or
 * clear invalidates older in-flight attempts. Notices dismiss themselves after
 * 3s (success) or 5s (error).
 */
export class ToastController {
  notice: Notice = $state({ kind: "idle" });
  #attempt = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** Invalidates older attempts, hides the current notice, returns a fence. */
  begin(): number {
    this.clear();
    return this.#attempt;
  }
  /** Publishes for an attempt from `begin()` unless something newer replaced it. */
  settle(attempt: number, kind: "success" | "error", message: string) {
    if (attempt === this.#attempt) this.#publish(kind, message);
  }
  show(kind: "success" | "error", message: string) {
    this.clear();
    this.#publish(kind, message);
  }
  clear() {
    this.#attempt++;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.notice = { kind: "idle" };
  }
  #publish(kind: "success" | "error", message: string) {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.notice = { kind, message };
    const attempt = this.#attempt;
    this.#timer = setTimeout(() => {
      if (attempt === this.#attempt) this.clear();
    }, toastDurations[kind]);
  }
}
