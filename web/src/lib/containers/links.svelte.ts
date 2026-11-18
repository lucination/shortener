import type { Api } from "../adapters/api";
import type { CopyAddress } from "../adapters/clipboard";
import type { Link } from "../generated";
import { linkRow } from "../mappings";
import { mapResource, resultResource } from "../resource";
import {
  filterLinks,
  toggleSelection,
  type LinkRow,
  type Resource,
} from "../view-models";
import type { Generation } from "./generation";
import type { PageOutcome } from "./outcome.svelte";
import { unauthorized } from "./session.svelte";
import type { ToastController } from "./toast.svelte";

/**
 * Links list screen: observed list, search, durable-ID selection and the
 * in-place quick actions (copy, enable/disable). Navigation-producing actions
 * and confirmations stay with the container and the command controller.
 */
export class LinksController {
  state: Resource<readonly Link[]> = $state({ kind: "pending" });
  search = $state("");
  selected: readonly number[] = $state([]);
  readonly #api: Api;
  readonly #copy: CopyAddress;
  readonly #generation: Generation;
  readonly #outcome: PageOutcome;
  readonly #toast: ToastController;
  readonly #active: () => boolean;
  constructor(deps: {
    api: Api;
    copy: CopyAddress;
    generation: Generation;
    outcome: PageOutcome;
    toast: ToastController;
    active: () => boolean;
  }) {
    this.#api = deps.api;
    this.#copy = deps.copy;
    this.#generation = deps.generation;
    this.#outcome = deps.outcome;
    this.#toast = deps.toast;
    this.#active = deps.active;
  }
  get rows(): Resource<readonly LinkRow[]> {
    return mapResource(this.state, (links) =>
      filterLinks(links.map(linkRow), this.search),
    );
  }
  /** Ready, visible and not already running an action. */
  get actionable(): boolean {
    return (
      this.#active() && this.state.kind === "ready" && !this.#outcome.pending
    );
  }
  find(id: number): Link | undefined {
    return this.state.kind === "ready"
      ? this.state.value.find((link) => link.id === id)
      : undefined;
  }
  reset() {
    this.state = { kind: "pending" };
    this.search = "";
    this.selected = [];
  }
  /**
   * Withdraws the previous list and observes a new one. Returns "stale" when a
   * newer generation replaced this request, "unauthorized" on 401/403.
   */
  async load(): Promise<"loaded" | "unauthorized" | "stale"> {
    this.reset();
    const request = this.#generation.current;
    const result = await this.#api.links();
    if (!this.#generation.owns(request)) return "stale";
    if (unauthorized(result)) return "unauthorized";
    this.state = resultResource(result, (value) => value.items);
    this.search = "";
    this.selected = [];
    return "loaded";
  }
  setSearch(search: string) {
    if (this.#active()) this.search = search;
  }
  select(id: number) {
    if (this.#active()) this.selected = toggleSelection(this.selected, id);
  }
  selectAll(checked: boolean) {
    if (!this.#active() || this.state.kind !== "ready") return;
    const visible = filterLinks(this.state.value.map(linkRow), this.search).map(
      (row) => row.id,
    );
    this.selected = checked
      ? [...new Set([...this.selected, ...visible])]
      : this.selected.filter((id) => !visible.includes(id));
  }
  /** Copies the primary short address; only the newest attempt reports. */
  async copyAddress(id: number) {
    const link = this.actionable ? this.find(id) : undefined;
    if (!link) return;
    const request = this.#generation.current;
    const attempt = this.#toast.begin();
    const address = link.addresses[0];
    if (!address) {
      this.#toast.settle(attempt, "error", "No address to copy.");
      return;
    }
    try {
      await this.#copy(`https://${address.domain}/${address.short_code}`);
      if (!this.#generation.owns(request)) return;
      this.#toast.settle(attempt, "success", "Short address copied.");
    } catch {
      if (!this.#generation.owns(request)) return;
      this.#toast.settle(
        attempt,
        "error",
        "Clipboard unavailable. Select and copy the short address.",
      );
    }
  }
  /** Flips enabled state. Resolves true when the list should be reloaded. */
  async toggle(id: number): Promise<boolean> {
    const link = this.actionable ? this.find(id) : undefined;
    if (!link) return false;
    const request = this.#generation.current;
    this.#outcome.begin();
    const result = await this.#api.patch(id, { enabled: !link.enabled });
    if (!this.#generation.owns(request)) return false;
    return this.#outcome.notify(result, "Link updated.");
  }
}
