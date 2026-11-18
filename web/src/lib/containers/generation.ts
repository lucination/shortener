/**
 * Application-wide stale-response fence. Every screen change, command,
 * cancellation, pagehide and unmount advances it; an async completion may only
 * publish while the generation it captured is still current.
 *
 * Listeners run synchronously on every advance. Controllers use this to keep
 * invariants such as "an issued access-token secret never survives a
 * generation change" structural instead of a manual reset list.
 */
export class Generation {
  #value = 0;
  readonly #listeners = new Set<() => void>();
  get current(): number {
    return this.#value;
  }
  owns(request: number): boolean {
    return request === this.#value;
  }
  advance(): number {
    this.#value++;
    for (const listener of this.#listeners) listener();
    return this.#value;
  }
  onAdvance(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
