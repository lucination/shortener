import type { Api } from "../adapters/api";
import type { CopyAddress } from "../adapters/clipboard";
import type { AccessTokenMetadata, IssuedAccessToken } from "../generated";
import { failureOutcome, resultResource } from "../resource";
import type { Outcome, Resource } from "../view-models";
import type { Generation } from "./generation";
import { unauthorized } from "./session.svelte";

/**
 * Account access-token management. The issued secret exists only in memory
 * for the issuance response's screen: every generation advance (navigation,
 * command, cancellation, pagehide, sign-out, unmount) clears it synchronously.
 */
export class AccessTokensController {
  tokens: Resource<readonly AccessTokenMetadata[]> = $state({
    kind: "pending",
  });
  name = $state("Chrome extension");
  days = $state(90);
  issued: IssuedAccessToken | undefined = $state();
  feedback: Outcome = $state({ kind: "idle" });
  readonly #api: Api;
  readonly #copy: CopyAddress;
  readonly #generation: Generation;
  readonly #active: () => boolean;
  constructor(deps: {
    api: Api;
    copy: CopyAddress;
    generation: Generation;
    active: () => boolean;
  }) {
    this.#api = deps.api;
    this.#copy = deps.copy;
    this.#generation = deps.generation;
    this.#active = deps.active;
    deps.generation.onAdvance(() => this.clearSecret());
  }
  clearSecret() {
    this.issued = undefined;
    this.feedback = { kind: "idle" };
  }
  /** Withdraws metadata so another account/screen never sees stale rows. */
  reset() {
    this.clearSecret();
    this.tokens = { kind: "pending" };
  }
  async load() {
    if (!this.#active()) return;
    const request = this.#generation.current;
    this.tokens = { kind: "pending" };
    const result = await this.#api.accessTokens();
    if (!this.#generation.owns(request) || !this.#active()) return;
    this.tokens = resultResource(result, (value) => value.items);
    if (unauthorized(result)) this.clearSecret();
  }
  async issue() {
    if (!this.#active() || this.feedback.kind === "pending") return;
    const request = this.#generation.current;
    this.issued = undefined;
    this.feedback = { kind: "pending" };
    const result = await this.#api.issueAccessToken({
      name: this.name,
      expires_in_days: this.days,
    });
    if (!this.#generation.owns(request) || !this.#active()) return;
    if (result.kind === "failed") {
      this.feedback = failureOutcome(result.error);
      return;
    }
    this.issued = result.value;
    this.feedback = { kind: "idle" };
    await this.load();
  }
  async revoke(id: number) {
    if (!this.#active() || this.feedback.kind === "pending") return;
    const request = this.#generation.current;
    this.feedback = { kind: "pending" };
    if (this.issued?.metadata.id === id) this.issued = undefined;
    const result = await this.#api.revokeAccessToken(id);
    if (!this.#generation.owns(request) || !this.#active()) return;
    this.feedback =
      result.kind === "ok"
        ? { kind: "success", message: "Access token revoked." }
        : failureOutcome(result.error);
    if (result.kind === "ok") await this.load();
  }
  async copySecret() {
    if (!this.issued || this.feedback.kind === "pending") return;
    const request = this.#generation.current,
      token = this.issued.token;
    const current = () =>
      this.#generation.owns(request) && this.issued?.token === token;
    this.feedback = { kind: "pending" };
    try {
      await this.#copy(token);
      if (current())
        this.feedback = { kind: "success", message: "Token copied." };
    } catch {
      if (current())
        this.feedback = {
          kind: "error",
          reason: "network",
          message: "Token could not be copied. Select it and copy manually.",
        };
    }
  }
}
