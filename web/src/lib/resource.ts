import type { Resource } from "./view-models";
import type { Result } from "./adapters/api";
export const mapResource = <A, B>(
  state: Resource<A>,
  map: (value: A) => B,
): Resource<B> =>
  state.kind === "ready" ? { kind: "ready", value: map(state.value) } : state;
export const resultResource = <A, B>(
  result: Result<A>,
  map: (value: A) => B,
): Resource<B> =>
  result.kind === "ok"
    ? { kind: "ready", value: map(result.value) }
    : { kind: "error", message: result.error.message };
