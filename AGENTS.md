# Shortener integration authority

## Routing and architecture

- `GET /{short}` is a native HTTP302, not JavaScript navigation. Keep password gates, `/v/{short}`, unlock/continue POSTs, generic unavailable404, atomic human-count claims and password-version grants.
- User API `/api`; admin API `/_/api`. Separate cookie/session authorities. Historical `/api/admin` and JS-only migration notes are obsolete.
- Two independent static SvelteKit builds: `web/` user SPA at `/`, `admin/` admin SPA at `/_/` with `paths.base=/_`. Admin is reached only by typing its URL. No admin navigation in the user shell. Explicit controlled presentation sharing from `web/src/lib`; effects remain in each application's container/adapters.
- Only authenticated users see Links, Account and Sign out. Product theme follows the OS, without selectors or browser-storage overrides. Attribution stays in `web/THIRD-PARTY-NOTICES.md`, not the UI.
- Inline controlled error presentation belongs beside its affected form/section. Preserve submitted input and separate passkey enrollment feedback.
- Actual serialized Rust DTOs derive ts-rs. `web/scripts/sync-contracts.mjs` copies the deterministic export; admin imports this same generated-contract parser, not duplicate wire types.
- Production: native Loco + SQLite serves both static builds; no Node runtime. Development only: Caddy3000 keeps same-origin Rust short/API/auth authority and proxies user Vite5173/admin Vite5174 and their distinct HMR paths.


## Contribution checks

Keep credentials outside Git. Use disposable local test databases and loopback mail capture. Run Rust tests, format checks, frontend type checks, tests, generated-contract drift checks and both static builds before submitting changes. Preserve third-party notices and font licenses.
