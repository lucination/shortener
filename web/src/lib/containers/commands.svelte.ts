import type { ActionFormView } from "../ActionForm.svelte";
import type { Api, Result } from "../adapters/api";
import type { BulkAction as WireBulkAction } from "../generated";
import { bulkActionLabels, type BulkAction } from "../view-models";
import type { Generation } from "./generation";
import type { PageOutcome } from "./outcome.svelte";
import type { SessionState } from "./session.svelte";

export type Command =
  | {
      kind: "bulk";
      ids: readonly number[];
      action: BulkAction;
      value: string;
    }
  | { kind: "delete-link"; id: number }
  | { kind: "remove-password"; id: number }
  | { kind: "signout" };

const count = (ids: readonly number[]) =>
  `${ids.length} ${ids.length === 1 ? "link" : "links"}`;

export function commandView(value: Command): ActionFormView {
  if (
    value.kind === "bulk" &&
    (value.action === "expiration" || value.action === "retention")
  )
    return {
      kind: "value",
      title: `${bulkActionLabels[value.action]} for ${count(value.ids)}`,
      description:
        "Blank clears the override. Only selected link IDs are changed.",
      label: value.action === "expiration" ? "Expiration" : "Retention days",
      type: value.action === "expiration" ? "datetime-local" : "number",
      value: value.value,
    };
  return {
    kind: "confirm",
    title:
      value.kind === "signout"
        ? "Sign out everywhere?"
        : value.kind === "remove-password"
          ? "Remove link password?"
          : value.kind === "delete-link"
            ? "Delete this link?"
            : `${bulkActionLabels[value.action]} ${count(value.ids)}?`,
    description:
      value.kind === "signout"
        ? "This signs out all sessions. Your passkeys and links stay."
        : value.kind === "remove-password"
          ? "Anyone with the address will be able to open this link."
          : value.kind === "delete-link" ||
              (value.kind === "bulk" && value.action === "delete")
            ? "Deleted addresses remain reserved."
            : `Apply this change to the selected ${value.kind === "bulk" && value.ids.length === 1 ? "link" : "links"}.`,
  };
}

/** Transient success notice shown after the links list is restored. */
export function commandSuccess(value: Exclude<Command, { kind: "signout" }>) {
  if (value.kind === "delete-link") return "Link deleted.";
  if (value.kind === "remove-password") return "Password removed.";
  const links = count(value.ids);
  switch (value.action) {
    case "enable":
      return `Enabled ${links}.`;
    case "disable":
      return `Disabled ${links}.`;
    case "delete":
      return `Deleted ${links}.`;
    case "expiration":
      return `Expiration updated for ${links}.`;
    case "retention":
      return `Retention updated for ${links}.`;
  }
}

const wholeNumber = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw Error("Enter a valid whole number.");
  return parsed;
};

/**
 * Confirmation/value commands (link delete, password removal, bulk updates,
 * sign out everywhere). A command completion publishes only while its
 * generation is current; session revocation is honoured whenever the same
 * session epoch is still authenticated, even on a different screen.
 */
export class CommandController {
  command: Command | undefined = $state();
  readonly #api: Api;
  readonly #generation: Generation;
  readonly #session: SessionState;
  readonly #outcome: PageOutcome;
  readonly #signedOut: () => void;
  readonly #completed: (message: string) => Promise<void>;
  constructor(deps: {
    api: Api;
    generation: Generation;
    session: SessionState;
    outcome: PageOutcome;
    /** The same session was revoked by sign-out everywhere. */
    signedOut: () => void;
    /** A link command succeeded; restore the list and report `message`. */
    completed: (message: string) => Promise<void>;
  }) {
    this.#api = deps.api;
    this.#generation = deps.generation;
    this.#session = deps.session;
    this.#outcome = deps.outcome;
    this.#signedOut = deps.signedOut;
    this.#completed = deps.completed;
  }
  get view(): ActionFormView | undefined {
    return this.command && commandView(this.command);
  }
  /** Opens a command. The caller has already advanced the generation. */
  open(next: Command) {
    this.command = next;
    this.#outcome.reset();
  }
  /** Screen replacement: forget the command without fencing on its own. */
  reset() {
    this.command = undefined;
  }
  /** Explicit cancel: fences any in-flight confirmation. */
  cancel() {
    this.#generation.advance();
    this.command = undefined;
    this.#outcome.reset();
  }
  /** Modal dismissal is refused while the confirmation is in flight. */
  dismiss() {
    if (!this.#outcome.pending) this.cancel();
  }
  setValue(value: string) {
    if (this.command?.kind === "bulk")
      this.command = { ...this.command, value };
  }
  async confirm() {
    if (!this.command || this.#outcome.pending) return;
    const target = this.command;
    const owner = this.#session.epoch;
    const request = this.#generation.current;
    this.#outcome.begin();
    let result: Result<unknown>;
    try {
      if (target.kind === "delete-link")
        result = await this.#api.remove(target.id);
      else if (target.kind === "remove-password")
        result = await this.#api.patch(target.id, { password: null });
      else if (target.kind === "signout")
        result = await this.#api.signoutEverywhere();
      else {
        const action: WireBulkAction =
          target.action === "expiration"
            ? {
                type: "expiration",
                expires_at: target.value
                  ? new Date(target.value).toISOString()
                  : null,
              }
            : target.action === "retention"
              ? { type: "retention", retention_days: wholeNumber(target.value) }
              : { type: target.action };
        const bulkResult = await this.#api.bulkUpdate({
          ids: [...target.ids],
          action,
        });
        if (!this.#generation.owns(request)) return;
        if (bulkResult.kind === "ok") {
          const failures = bulkResult.value.items.filter(
            (item) => item.status === "failed",
          );
          if (failures.length) {
            this.#outcome.fail(
              failures
                .map((item) => `Link #${item.id}: ${item.error.message}`)
                .join(" · "),
              "validation",
            );
            return;
          }
        }
        result = bulkResult;
      }
    } catch (error) {
      if (!this.#generation.owns(request) || !this.#session.owns(owner)) return;
      this.#outcome.fail(
        error instanceof Error ? error.message : "Invalid action.",
        "validation",
      );
      return;
    }
    // Revocation is authoritative for the same session even on a different screen.
    if (!this.#session.owns(owner)) return;
    if (target.kind === "signout" && result.kind === "ok") {
      this.#signedOut();
      return;
    }
    if (!this.#generation.owns(request)) return;
    if (!this.#outcome.notify(result, "Action completed.")) return;
    this.command = undefined;
    if (target.kind !== "signout")
      await this.#completed(commandSuccess(target));
  }
}
