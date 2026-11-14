import type { Resource, Outcome } from "./view-models";
import type { Result, ApiError } from "./adapters/api";
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
    : failureOutcome(result.error);

export const failureOutcome = (
  error: ApiError,
): Extract<Outcome, { kind: "error" }> => ({
  kind: "error",
  message: error.message,
  reason:
    error.kind === "network"
      ? "network"
      : error.kind === "http" && [401, 403].includes(error.status)
        ? "authentication"
        : error.kind === "http" && [400, 409, 422].includes(error.status)
          ? "validation"
          : "server",
});
