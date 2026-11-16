# Precision frontend

The selected Precision direction is integrated into the user and separate admin applications. Shared tokens live in `lib/styles/presentation.css`; `app.css` supplies the compact application layout. The OS controls the theme. Presentation components receive typed data and callbacks; user and admin containers retain their independent API/session ownership.

## Storybook

`design-language--compare` and `design-language--precision` now mount the actual `AppShell`, `Dashboard`, complete `LinkEditor`, `BulkImport`, `Analytics` and shared `FocusedModal` through `story-harness/DashboardHarness.svelte`. The harness owns only disposable story state. It does not call the API or browser credential/clipboard services. Page/component stories cover pending, empty, failure, selection and enrollment states.

Paper and Studio remain separate historical alternatives using `DesignHarness` and `DesignWorkspace`. `DesignModal` delegates to the same `presentation/FocusedModal` used in production. No application container imports a story harness or fixture.

The native password, unlock-error and continue documents keep their HTTP forms and redirects. Their HTML templates in `lib/presentation/native-*.html` are included directly by the Rust handler. `PublicGateStory` uses those same templates and Vite-processed application CSS inside a sandboxed frame, with form submission disabled in Storybook. It does not recreate the native screens as SPA components. The unavailable story mounts the actual `PublicPage`. A browser's navigation-pending state is not presented as a separate native application state.

Fixtures are deterministic DTO-derived records from `fixtures.ts`. They are not live account data. Native document inputs are escaped before template substitution in both Rust and the story harness.

Creator statistics use the overview-first direction: identity and date controls, compact summary, a wide human-click timeline, then ranked country/device/referrer breakdowns. An event-first layout was rejected because raw requests obscure the overview; the separate events modal is retained. Breakdown counts include all recorded event classifications, not just human clicks. Date ranges are inclusive UTC, and daily aggregates survive raw-event retention. The Analytics stories render the production controlled component with deterministic ready/empty/loading/failure data; API and session effects remain in ManagementContainer. Passkey stories likewise use controlled names/list props without fetching.

## Verification

Run `npm test`, `npm run check`, `npm run check-contracts`, `npm run build` and `npm run build-storybook` from `web/`, and the admin check/build from `admin/`. Rust tests cover the native forms, grants, redirect claims and template packaging. The user static finalizer emits `presentation.css` from the compiled application CSS for native documents.

`verify-precision-links.mjs` and `verify-precision-app.mjs` exercise the actual production build against explicitly admitted loopback fixtures. Supply `PRECISION_BASE`, `PRECISION_SESSION_FILE`, and for the full app verifier `PRECISION_EMAIL` and `PRECISION_ADMIN_TOKEN`; keep credentials outside Git. The full verifier tests link controls, CSV/bulk operations, account persistence and WebAuthn, separate admin actions, and native public forms. External destination navigation is intercepted, not sent to a real provider. Screenshots and receipts go to task-owned evidence directories.
