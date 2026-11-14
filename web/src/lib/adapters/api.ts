import { z } from "zod";
import * as schema from "./schemas";
import type * as DTO from "../generated";
import type { DateRange } from "../view-models";
export type ApiError =
  | { kind: "http"; status: number; code: string; message: string }
  | { kind: "network"; message: string }
  | { kind: "contract"; message: string };
export type Result<T> =
  { kind: "ok"; value: T } | { kind: "failed"; error: ApiError };
export function createApi(fetcher: typeof fetch) {
  async function request<T>(
    path: string,
    parser: z.ZodType<T>,
    method = "GET",
    body?: unknown,
  ): Promise<Result<T>> {
    let response: Response;
    try {
      response = await fetcher(path, {
        method,
        credentials: "same-origin",
        headers:
          body === undefined
            ? { Accept: "application/json" }
            : {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return {
        kind: "failed",
        error: {
          kind: "network",
          message:
            "The server could not be reached. Check your connection and retry.",
        },
      };
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      return {
        kind: "failed",
        error: {
          kind: "contract",
          message: "The server returned an unreadable response.",
        },
      };
    }
    if (!response.ok) {
      const error = schema.errorSchema.safeParse(value);
      return {
        kind: "failed",
        error: {
          kind: "http",
          status: response.status,
          code: error.success ? error.data.code : "http_error",
          message: error.success
            ? error.data.message
            : `Request failed (${response.status}).`,
        },
      };
    }
    const parsed = parser.safeParse(value);
    return parsed.success
      ? { kind: "ok", value: parsed.data }
      : {
          kind: "failed",
          error: {
            kind: "contract",
            message:
              "The server response does not match the generated API contract.",
          },
        };
  }
  const dates = (range: DateRange) =>
    new URLSearchParams({ from: range.from, to: range.to }).toString();
  return {
    me: () => request("/api/me", schema.userSchema),
    links: () => request("/api/links", schema.linkListSchema),
    create: (body: DTO.LinkInput) =>
      request("/api/links", schema.linkSchema, "POST", body),
    patch: (id: number, body: DTO.LinkPatch) =>
      request(`/api/links/${id}`, schema.linkSchema, "PATCH", body),
    remove: (id: number) =>
      request(`/api/links/${id}`, schema.messageSchema, "DELETE"),
    bulk: (body: DTO.BulkInput) =>
      request("/api/links/bulk", schema.bulkSchema, "POST", body),
    bulkUpdate: (body: DTO.BulkUpdate) =>
      request("/api/links/bulk-update", schema.bulkUpdateSchema, "POST", body),
    stats: (id: number, range: DateRange) =>
      request(`/api/links/${id}/stats?${dates(range)}`, schema.statsSchema),
    events: (id: number, range: DateRange) =>
      request(
        `/api/links/${id}/events?${dates(range)}`,
        schema.eventListSchema,
      ),
    account: (body: DTO.AccountPatch) =>
      request("/api/account", schema.userSchema, "PATCH", body),
    signoutEverywhere: () =>
      request(
        "/api/account/sign-out-everywhere",
        schema.messageSchema,
        "POST",
        {},
      ),
    logout: () => request("/api/auth/logout", schema.messageSchema, "POST", {}),
    magic: (body: DTO.EmailInput) =>
      request("/api/auth/magic-link", schema.messageSchema, "POST", body),
    adminLogin: (body: DTO.TokenInput) =>
      request("/api/admin/login", schema.messageSchema, "POST", body),
    adminLogout: () =>
      request("/api/admin/logout", schema.messageSchema, "POST", {}),
    users: () => request("/api/admin/users", schema.userListSchema),
    createUser: (body: DTO.UserInput) =>
      request("/api/admin/users", schema.userSchema, "POST", body),
    patchUser: (id: number, body: DTO.UserPatch) =>
      request(`/api/admin/users/${id}`, schema.userSchema, "PATCH", body),
    removeUser: (id: number) =>
      request(`/api/admin/users/${id}`, schema.messageSchema, "DELETE"),
    signoutUser: (id: number) =>
      request(
        `/api/admin/users/${id}/sign-out-everywhere`,
        schema.messageSchema,
        "POST",
        {},
      ),
    adminLinks: () => request("/api/admin/links", schema.linkListSchema),
    adminEvents: () => request("/api/admin/events", schema.eventListSchema),
    usage: () => request("/api/admin/usage", schema.usageSchema),
    registrationOptions: () =>
      request(
        "/api/auth/passkeys/register/options",
        schema.passkeyOptionsSchema,
        "POST",
        {},
      ),
    authenticationOptions: (body: DTO.EmailInput) =>
      request(
        "/api/auth/passkeys/authenticate/options",
        schema.passkeyOptionsSchema,
        "POST",
        body,
      ),
    register: (body: DTO.PasskeyVerify) =>
      request(
        "/api/auth/passkeys/register/verify",
        schema.messageSchema,
        "POST",
        body,
      ),
    authenticate: (body: DTO.PasskeyVerify) =>
      request(
        "/api/auth/passkeys/authenticate/verify",
        schema.userSchema,
        "POST",
        body,
      ),
  };
}
export type Api = ReturnType<typeof createApi>;
