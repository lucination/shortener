import type { LinkInput, LinkPatch } from "../generated";
import type { LinkDraft } from "../view-models";
export type DraftResult =
  | { kind: "valid"; input: LinkInput; patch: LinkPatch }
  | { kind: "invalid"; message: string };
export function parseDraft(draft: LinkDraft): DraftResult {
  try {
    const destination = new URL(draft.destination);
    if (!["http:", "https:"].includes(destination.protocol))
      throw Error("Destination must be an http:// or https:// URL.");
    const positive = (value: string): number | null => {
      if (!value.trim()) return null;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw Error("Limits and retention must be positive whole numbers.");
      return parsed;
    };
    const expires_at = draft.expiresAt
      ? new Date(draft.expiresAt).toISOString()
      : null;
    const input: LinkInput = {
      destination: draft.destination,
      alias: draft.alias.trim() || null,
      title: draft.title || null,
      description: draft.description || null,
      password: draft.password || null,
      expires_at,
      click_limit: positive(draft.clickLimit),
      interstitial: draft.interstitial,
      query_mode: draft.queryMode,
      retention_days: positive(draft.retentionDays),
    };
    const { alias: _alias, password: _password, ...fields } = input;
    const patch: LinkPatch = {
      ...fields,
      ...(draft.password ? { password: draft.password } : {}),
    };
    return { kind: "valid", input, patch };
  } catch (error) {
    return {
      kind: "invalid",
      message: error instanceof Error ? error.message : "Invalid link fields.",
    };
  }
}
