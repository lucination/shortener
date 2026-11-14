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
