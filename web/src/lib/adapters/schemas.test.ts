it("accepts the server's Unicode character bound for passkey list names", async () => {
  const { passkeySummarySchema } = await import("./schemas");
  expect(
    passkeySummarySchema.safeParse({ id: 1, name: "🔑".repeat(80) }).success,
  ).toBe(true);
  expect(
    passkeySummarySchema.safeParse({ id: 1, name: "🔑".repeat(81) }).success,
  ).toBe(false);
});
import { it, expect } from "vitest";
import { linkListSchema } from "./schemas";
const link = {
  id: 1,
  owner_id: 2,
  destination: "https://example.org/notes",
  title: null,
  description: null,
  enabled: true,
  deleted_at: null,
  expires_at: null,
  click_limit: null,
  human_clicks: 2,
  password_protected: false,
  interstitial: false,
  query_mode: "discard",
  retention_days: null,
  created_at: "2026-11-14T10:00:00Z",
  addresses: [
    { id: 1, domain_id: 1, domain: "example.com", short_code: "notes" },
  ],
};
it("accepts the complete serialized LinkList with explicit nullable values", () => {
  expect(linkListSchema.safeParse({ items: [link], total: 1 }).success).toBe(
    true,
  );
});
it("rejects malformed wire states rather than manufacturing valid DTOs", () => {
  for (const value of [
    { items: [{ ...link, enabled: "yes" }], total: 1 },
    { items: [{ ...link, query_mode: "merge" }], total: 1 },
    { items: [{ ...link, deleted_at: undefined }], total: 1 },
    { items: [{ ...link, id: 1.5 }], total: 1 },
    { items: [{ ...link, destination: "javascript:alert(1)" }], total: 1 },
    { items: [{ ...link, created_at: "tomorrow" }], total: 1 },
  ])
    expect(linkListSchema.safeParse(value).success).toBe(false);
});

it("rejects control characters and unpaired surrogates in passkey names", async () => {
  const { passkeySummarySchema } = await import("./schemas");
  for (const name of [
    " ",
    "line\nbreak",
    "key\u0085name",
    "bad\ud800",
    "bad\udfff",
  ]) {
    expect(
      passkeySummarySchema.safeParse({ id: 1, name }).success,
      JSON.stringify(name),
    ).toBe(false);
  }
  for (const name of ["a".repeat(80), "🔑".repeat(80), "a🔑".repeat(40)])
    expect(passkeySummarySchema.safeParse({ id: 1, name }).success).toBe(true);
});
