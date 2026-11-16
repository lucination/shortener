# Storybook design language exploration

Preview only; no production routes or application containers import these files.

- `DesignWorkspace.svelte` is a stateless controlled presentation with typed `LinkRow` data and callbacks.
- `DesignHarness.svelte` owns disposable search, create/edit/import and enable state. No API, clipboard, authentication, persistence or external writes. Address action displays selectable text rather than changing the clipboard.
- `DesignModal.svelte` presents create/edit/import forms; `DesignPopover.svelte` anchors clicks and address details to the selected row action. A single discriminated overlay state prevents stacked editors and disclosures. Cancel, outside click and Escape dismiss without saving; validation errors keep the draft open.
- Fixtures come from the existing Rust DTO-derived `simulatedLinkRows` mapping. Counts are human clicks, never total requests.
- `DesignCompare.svelte` opens the selected Precision workspace. The former comparison story ID remains valid; Paper and Studio remain separate stories.
- `design.css` is namespaced, including explicit overrides for the global Storybook monospace typography. Every palette follows OS light/dark; there is no theme picker.

Start with **Design language / Compare** (`design-language--compare`), which now opens Precision without comparison controls. The Precision story shows the same workspace. Precision retains its OKLCH light/dark surface ladder, Inter/system sans at 11–13px, 4px table padding, 4px control radii and flat surfaces. The browser regression checks computed palette, typography and spacing on actual controls rather than adding specimen UI. Paper and Studio retain their individual typography and geometry.

The product canvas uses a brand bar, one Links heading, actions, search and a table. Click counts still come from the existing DTO mapping; only their display label changed to Clicks. There is no count-methodology explanation in the UI.

## Verification

From `web/`, run `npm run check`, `npm test` and `npm run build-storybook`.
Serve `storybook-static/` on port 6006, then run
`node scripts/verify-design-language.mjs`. Install the Playwright Chromium browser
and its system dependencies first if needed. `STORYBOOK_URL` and `EVIDENCE_DIR`
override the loopback URL and screenshot output directory. The browser regression
exercises each direction in both OS themes at desktop and phone widths, checks
row-action geometry and document overflow, and verifies local interactions. It also
checks the selected default at desktop, phone and short-phone sizes. It rejects API
calls and records page errors.
