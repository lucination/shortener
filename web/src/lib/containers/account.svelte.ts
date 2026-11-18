import type { Api } from "../adapters/api";
import type { CopyAddress } from "../adapters/clipboard";
import type { User } from "../generated";
import { AccessTokensController } from "./access-tokens.svelte";
import type { Generation } from "./generation";
import type { PageOutcome } from "./outcome.svelte";
import { PasskeysController } from "./passkeys.svelte";
import type { SessionState } from "./session.svelte";

const retentionText = (user: User) =>
  user.retention_days === null ? "" : String(user.retention_days);

/**
 * Account screen: profile/retention, passkeys and access tokens. The container
 * only opens it with an observed user, resets it when any screen changes and
 * abandons enrollment when leaving; each area keeps its own fences.
 */
export class AccountController {
  user: User | undefined = $state();
  retention = $state("");
  readonly passkeys: PasskeysController;
  readonly tokens: AccessTokensController;
  readonly #api: Api;
  readonly #generation: Generation;
  readonly #active: () => boolean;
  readonly #outcome: PageOutcome;
  constructor(deps: {
    api: Api;
    copy: CopyAddress;
    generation: Generation;
    session: SessionState;
    outcome: PageOutcome;
    active: () => boolean;
    loginBusy: () => boolean;
  }) {
    this.#api = deps.api;
    this.#generation = deps.generation;
    this.#active = deps.active;
    this.#outcome = deps.outcome;
    this.passkeys = new PasskeysController(deps);
    this.tokens = new AccessTokensController(deps);
  }
  /** Screen replacement: withdraw secrets and token metadata. */
  reset() {
    this.tokens.reset();
  }
  /** Abort a still-preparing enrollment; verification keeps ownership. */
  abandon() {
    this.passkeys.abandon();
  }
  /** Populate a freshly selected Account screen, then load its sections. */
  async open(user: User) {
    this.user = user;
    this.retention = retentionText(user);
    this.passkeys.open();
    await this.passkeys.load();
    await this.tokens.load();
  }
  async saveRetention() {
    if (!this.#active() || this.#outcome.pending) return;
    const request = this.#generation.current;
    const value = this.retention.trim() ? Number(this.retention) : null;
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
      this.#outcome.fail(
        "Retention must be a positive whole number.",
        "validation",
      );
      return;
    }
    this.#outcome.begin();
    const result = await this.#api.account({ retention_days: value });
    if (!this.#generation.owns(request) || !this.#active()) return;
    if (
      this.#outcome.notify(result, "Retention saved.") &&
      result.kind === "ok"
    ) {
      this.user = result.value;
      this.retention = retentionText(result.value);
    }
  }
}
