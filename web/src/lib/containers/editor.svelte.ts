import type { Api } from "../adapters/api";
import { parseDraft } from "../adapters/draft";
import { emptyDraft, type EditorMode, type LinkDraft } from "../view-models";
import type { Generation } from "./generation";
import type { PageOutcome } from "./outcome.svelte";

/**
 * Create/edit link form. Invalid drafts never become requests; failures stay
 * inline beside the form with the submitted draft preserved.
 */
export class EditorController {
  mode: EditorMode = $state({ kind: "create" });
  draft: LinkDraft = $state(emptyDraft);
  readonly #api: Api;
  readonly #generation: Generation;
  readonly #outcome: PageOutcome;
  readonly #active: () => boolean;
  constructor(deps: {
    api: Api;
    generation: Generation;
    outcome: PageOutcome;
    active: () => boolean;
  }) {
    this.#api = deps.api;
    this.#generation = deps.generation;
    this.#outcome = deps.outcome;
    this.#active = deps.active;
  }
  open(mode: EditorMode, draft: LinkDraft = emptyDraft) {
    this.mode = mode;
    this.draft = draft;
  }
  setDraft(draft: LinkDraft) {
    if (this.#active()) this.draft = draft;
  }
  /** Resolves the success notice when the link was saved, else undefined. */
  async save(): Promise<string | undefined> {
    if (!this.#active() || this.#outcome.pending) return;
    const mode = this.mode;
    const request = this.#generation.current;
    const parsed = parseDraft(this.draft);
    if (parsed.kind === "invalid") {
      this.#outcome.fail(parsed.message, "validation");
      return;
    }
    this.#outcome.begin();
    const result =
      mode.kind === "create"
        ? await this.#api.create(parsed.input)
        : await this.#api.patch(mode.id, parsed.patch);
    if (!this.#generation.owns(request)) return;
    const message = mode.kind === "create" ? "Link created." : "Link saved.";
    return this.#outcome.notify(result, message) ? message : undefined;
  }
}
