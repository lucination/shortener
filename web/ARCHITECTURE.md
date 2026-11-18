# Frontend boundaries

## Functional core

- `view-models.ts`: immutable presentation records; discriminated resource and outcome states. A ready value cannot coexist with loading/error flags. Editor create mode has no ID; edit mode requires its durable ID.
- `mappings.ts`: generated Rust DTOs → presentation projections. Unknown geography stays unknown. Approximate daily uniques are not combined into a multi-day distinct count.
- `bulk.ts`, `adapters/draft.ts`: pure CSV and form interpretation. Invalid rows retain row identity; invalid drafts never become requests. PATCH omission is distinct from explicit null, especially unchanged passwords.
- `transitions.ts`, `resource.ts`: pure exhaustive lifecycle transformations. Reload withdraws stale ready data.

## Presentation: stateless and controlled

All top-level `src/lib/*.svelte` components render typed explicit props and emit callbacks. They do not own `$state`, fetch, sessions, navigation, storage, or application lifecycle. The architecture regression test enforces this boundary. `Dashboard`, `LinkEditor`, `BulkImport`, `Analytics`, `EventTable`, `AccountPanel`, `AuthPanel`, `SignInPage`, `AdminPanel`, `PublicPage`, `ActionForm`, `AppShell` and `ResourceStatus` are the actual production components used by both the SPA and Storybook.

Primitives in `src/lib/presentation/` may own ephemeral DOM-only state. `RowMenu` (the per-row More actions menu button) keeps only its open flag and position, closes on Escape/outside click/blur/scroll, keeps one menu open per page and reports the chosen item id through a callback; it owns no application data.

`PasskeySection` is a separate controlled component with an `idle | enrolling | succeeded(message) | failed(message)` enrollment union. `AccountPanel` composes it; enrollment feedback cannot escape into retention/session feedback. The container owns WebAuthn effects and guards stale completions, while independent account retention saves preserve enrollment state.

`Resource<T>` is `pending | error(message) | ready(value)`. `Outcome` is `idle | pending | error(message) | success(message)`. View unions associate each screen with its meaningful required data. Password gates cannot receive a preview destination. Selection and management commands carry durable IDs, not row positions.

## Effect shell

`containers/AppContainer.svelte` owns lifecycle, session discovery, page routing and wiring. Per-area rune controllers in `containers/*.svelte.ts` own their state and reset/cancel semantics: `account` (retention, composing `passkeys` enrollment/rename and `access-tokens`), `auth` (magic link and passkey login), `links` (list, selection, copy, toggle), `commands` (confirmations, bulk updates, sign out everywhere), `editor`, `import`, plus shared `session` (epoch authority), `outcome` (current screen's action outcome) and `toast` (the single transient quick-action notice rendered by controlled `Toast.svelte`; inline form/section errors stay beside their form). `generation.ts` is the one stale-response fence; every advance synchronously clears any issued access-token secret. `adapters/api.ts` accepts a fetch implementation; every response is JSON `unknown`, checked by executable Zod schemas constrained by actual generated ts-rs DTOs. HTTP, network, and contract failures are distinct. Cookies use same-origin credentials; administrator tokens are not put into URLs or browser storage. Passkey browser effects are isolated in `adapters/passkeys.ts` and use standard WebAuthn serialization through SimpleWebAuthn.

`containers/ManagementContainer.svelte` owns the native creator pages `/{short}/statistics` and `/{short}/edit`. On the statistics page it owns the draft and applied date range, the selected Overview/Events view (the client-only `#events` fragment, read on load and on `hashchange`, written with `history.replaceState`), and per-view requests: each view loads lazily for the applied range, a new applied range fences older requests and reloads only the visible view. The links table's statistics and events actions navigate to that page; there is no in-app statistics/events modal.

Backend-rendered `/v/{short}` password and preview gates remain server-authoritative. The SPA does not attempt to discover password-protected destinations. `PublicPage` provides controlled design stories for these states; backend HTML gate integration is a separate acceptance boundary.

## Contracts

`src/lib/generated/index.ts` is copied byte-for-byte from the backend's `contracts/bindings/index.ts`. Never edit it. From `web/`, run `npm run sync-contracts` after backend export, then `npm run check-contracts`. During parallel development pass `-- --source=../contracts/bindings/index.ts`. Backend check-only generation is `cargo run --bin export-contracts -- --check`. Schemas deliberately do runtime validation, not generic `as T` assertions.

## Storybook isolation

Static stories render controlled production components with explicit fixture states. They never import the production container or API client. `fixtures.ts` contains deterministic generated-DTO fixtures using documentation-only IP addresses and `example.org` URLs. `story-harness/DashboardHarness.svelte` is the clearly separate optional interactive fixture owner; no fetch mocking or live request adapter exists. Fixture data never enters the application container. Browser verification fences non-local and API requests. Sample-data disclosure belongs in developer documentation/Storybook metadata only; product canvases and sidebar names have no simulation banners or suffixes.

Build static Storybook and serve it via the admitted box supervisor; do not publish the development/HMR/story-writing service. Port 6006 is reserved for the static build. Parent owns visibility and temporary private links.

## Verification

`npm test`, `npm run check`, `npm run build`, `npm run build-storybook`, `node scripts/verify-browser.mjs` and the backend-generated contract drift check cover distinct boundaries. Adapter and container tests inject deterministic HTTP responses, explicitly simulated; they are not proof of live daemon behavior or physical passkey enrollment. Playwright checks every actual story canvas at desktop, mobile and short-height viewports, rejects backend/nonlocal requests, and exercises the interactive fixture harness.

`SignInPage` is the shared Precision user sign-in presentation in both production
and Storybook. `sign-in.ts` models its lifecycle independently of generic action
feedback. `AuthPanel` composes it for user email/passkey login and retains the
separate administrator-token presentation. Production never imports the story
harness. `styles/presentation.css` owns shared visual tokens; system preference is
the only theme authority. Cancelling holds resubmission until outstanding options
settle (including their browser-binding cookie); stale options cannot open a picker.
Assertion submission removes cancellation because session creation is authoritative.
