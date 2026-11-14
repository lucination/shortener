import type { Resource } from "./view-models";
export type RequestEvent<T> =
  | { kind: "start" }
  | { kind: "resolve"; value: T }
  | { kind: "reject"; message: string };
export const transition = <T>(
  _state: Resource<T>,
  event: RequestEvent<T>,
): Resource<T> => {
  switch (event.kind) {
    case "start":
      return { kind: "pending" };
    case "resolve":
      return { kind: "ready", value: event.value };
    case "reject":
      return { kind: "error", message: event.message };
  }
};
