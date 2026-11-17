import { it, expect } from "vitest";
import { parseDraft } from "./draft";
import { emptyDraft } from "../view-models";
it("separates create defaults from PATCH omission for an unchanged password", () => {
  const result = parseDraft({
    ...emptyDraft,
    destination: "https://example.org",
    title: "",
  });
  expect(result.kind).toBe("valid");
  if (result.kind === "valid") {
    expect(result.input.password).toBeNull();
    expect(result.patch).not.toHaveProperty("password");
    expect(result.patch.title).toBeNull();
  }
});
it("rejects nonpositive or malformed count/expiry fields", () => {
  for (const draft of [
    { clickLimit: "0" },
    { retentionDays: "1.5" },
    { expiresAt: "not a date" },
    { destination: "javascript:alert(1)" },
  ])
    expect(
      parseDraft({
        ...emptyDraft,
        destination: "https://example.org",
        ...draft,
      }).kind,
    ).toBe("invalid");
});

it("never includes a short alias in an existing-link patch even if a caller replaces the draft alias", () => {
  const parsed = parseDraft({
    ...emptyDraft,
    destination: "https://example.org",
    alias: "Must-not-change",
  });
  expect(parsed.kind).toBe("valid");
  if (parsed.kind === "valid") {
    expect(parsed.input.alias).toBe("Must-not-change");
    expect(parsed.patch).not.toHaveProperty("alias");
    expect(parsed.patch).not.toHaveProperty("short_code");
    expect(parsed.patch).not.toHaveProperty("addresses");
  }
});
