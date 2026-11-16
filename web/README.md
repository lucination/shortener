# Shortener frontend

SvelteKit static-adapter SPA, Svelte 5, Tailwind v4, static Storybook. No Node server is needed by the app runtime. Backend must serve existing build files, route known SPA paths, preserve real missing-asset 404s and short-address routing precedence, and use `build/200.html` only for the agreed shell fallback.

```sh
cd web
npm ci
npm run sync-contracts
npm run check-contracts
npm run check
npm test
npm run build
npm run build-storybook
```

`build/` contains the SPA. `storybook-static/` contains the isolated design workbench. `node scripts/verify-browser.mjs` expects the latter at `http://127.0.0.1:6006` and requires `npx playwright install chromium`. Screenshots and machine-readable evidence go under ignored `test-results/`.

Every production build creates both `build/index.html` for Loco's root and `build/200.html` for the SPA fallback. Application development uses supervised Vite5173 behind the same-origin Rust/gateway3000, including WebSocket upgrades for `/__frontend_hmr`; no browser redirect to a different frontend origin. API failures remain real backend responses, never fixture fallback. Vite is development-only; keep static Storybook6006 separate. `scripts/verify-live-readonly.mjs` checks the actual admitted local daemon and served SPA without mutations; `verify-hmr.mjs` coordinates a reversible text/CSS probe after gateway readiness.

The stylesheet preserves the user's supplied character-grid design: JetBrains Mono (locally hosted normal and italic variable WOFF2 faces, full weight range 100–800, no ligatures, no synthetic faces), warm paper and charcoal themes, square 2px borders, boxed tables, double rules. Light/dark follows system preference only. Font binaries are the Latin variable assets from `@fontsource-variable/jetbrains-mono`, pinned by `package-lock.json`; JetBrains Mono uses the SIL Open Font License in `static/fonts/OFL.txt`. Verify binary axes with `python scripts/check-fonts.py` (requires fonttools and brotli), and every normal/italic weight in Chromium with the browser script. Monospace Web design attribution: Oskar Wickström, MIT, https://owickstrom.github.io/the-monospace-web/ . See `THIRD-PARTY-NOTICES.md`.

Read `ARCHITECTURE.md` for the required stateless/stateful isolation and functional core boundaries. Stories are simulated, never live data. All network contracts are generated from serialized backend Rust DTOs, with checked runtime parsing.

## App display name

`PUBLIC_APP_NAME` is a **build-time** public SvelteKit setting, not a runtime Rust
or container setting. If static assets are missing, the Rust fallback is a generic
application-unavailable page rather than inventing a configured display name. It defaults to `Shortener`; whitespace is trimmed and an
empty value uses the default. Names render as text, never HTML. It changes the
user/public/admin shell branding and document titles, not RP IDs, origins, cookie
names, database identities or the WebAuthn relying-party protocol configuration.

Set the same value for both static SPAs:

```sh
PUBLIC_APP_NAME='Fieldlinks' npm --prefix web run build
PUBLIC_APP_NAME='Fieldlinks' npm --prefix admin run build
```

For local development, copy the corresponding `.env.example` to `.env` in each
SPA directory. The root `.env` is not automatically a SvelteKit app's env file.
For a container image, build with `--build-arg PUBLIC_APP_NAME=Fieldlinks`; the
single UI build stage supplies it to both SPAs. Passing `docker run -e
PUBLIC_APP_NAME=...` does **not** rename an already built image. Rebuild static
assets/image to change it. No backend runtime configuration endpoint was added.

### Precision sign-in

Open **Precision / Sign in / Sign in** (`precision-sign-in--sign-in`). The reusable
`SignInPage.svelte` takes an explicit `appName`, email, typed lifecycle and
callbacks. `SignInHarness.svelte` alone owns disposable state and timers; stories
make no auth requests, send no emails and invoke no credential ceremony. The
passkey button is independent of email form validation, including empty email.
Sending and passkey-pending stories intentionally hold their pending state;
interactive submit/retry flows settle locally. The custom-name story uses
`Fieldlinks`. Production user authentication mounts the same controlled component
through `AuthPanel` and `AppContainer`; the preview harness is never imported by
production. The selected Precision tokens live at the shared presentation boundary
in `styles/presentation.css`. The admin token application stays at its separate
entrypoint with its existing presentation.

The user container owns the real email/passkey lifecycle. Email remains visible
through pending, accepted and failed requests; acceptance is not proof of delivery.
Passkey initiation never requires email. Cancel aborts a pending browser ceremony
and fences a held options response; once assertion verification is submitted, the
UI waits for its authoritative result instead of offering misleading cancellation.

Run `node scripts/verify-sign-in.mjs` after building Storybook. It exercises both
OS themes, desktop/phone/short-height layouts, send/resend/retry/cancel/error,
empty-email passkey initiation, custom brand/title and zero API/credential calls.
Screenshots and byte-identity receipt are written to `test-results/sign-in/`.

## Usernameless passkey sign-in

The user passkey button starts independently of the email form. The production
adapter posts `{}` for authentication options, then invokes the browser's explicit
passkey ceremony. The server no longer looks up an email or returns a credential
allow-list at this public endpoint. It binds the five-minute server-held challenge
to an HttpOnly, SameSite browser cookie and consumes challenge state before
assertion verification. The returned user handle must identify an eligible account
that owns the asserted credential. WebAuthn still verifies signature, challenge,
origin/RP and user verification; finalization rechecks account eligibility and the
current credential counter transactionally before creating a session. A bounded
latest-revocation revision per account also fences previously issued anonymous
ceremonies, including after suspension/reactivation and database reopen, without
invalidating another account's ceremony.

New enrollment requests `residentKey: required`, `requireResidentKey: true` and
user verification. Existing stored credential records are not rewritten or
removed. Earlier enrollment requested `residentKey: discouraged`; that does not
prove every existing credential is non-discoverable. Already-discoverable keys
can work without email. A non-discoverable credential cannot appear in the
usernameless picker: use an email sign-in link and enroll a discoverable passkey
on a supported device. There is no insecure email fallback inside the passkey
ceremony and no change to the separate administrator token entrypoint.

`tests/passkeys.rs` covers actual signed software-authenticator assertions,
legacy credential storage/verification, anonymous options, handle/credential
binding, replay, expiry, origin/signature/challenge tampering, suspended/deleted
accounts and required-resident enrollment options. Its software authenticator
cannot store resident credentials; the marked legacy fixtures intentionally use
the old selection policy only inside those tests.

After building `web/`, run the real-browser check explicitly:

```sh
cargo test --locked -j1 --test passkeys browser_virtual_authenticator_signs_in_without_email -- --ignored --nocapture
```

That check starts an in-memory loopback backend serving the actual built `/`
route (not a page harness), verifies signed-out navigation, both OS themes,
desktop/phone/short-height geometry, email pending/accepted/retry and held-options
cancellation, then creates a test session directly
without sending email, and drives the built application with a Chromium CDP CTAP2
resident/user-verifying virtual authenticator. It checks enrollment, sign out,
empty-email sign in, browser binding and replay rejection. It does not establish
support for any particular user's existing authenticator. Evidence is written to
`web/test-results/passkey-sign-in/`. No real email, external identity provider or
user authenticator is used by this test.

`verify-user-sign-in.mjs` can also target a separately started local native app:
`SIGNIN_BASE=http://localhost:3000 node scripts/verify-user-sign-in.mjs`.
Use an isolated task-local database. Its email address is intentionally unknown,
so acceptance exercises the real anti-enumeration endpoint without delivering mail.
The two 503 probes are explicitly intercepted failure responses, not provider tests.
Evidence is stored under `test-results/real-sign-in/`. Set `SIGNIN_APP_NAME` when
verifying a custom-name build. The resident-credential ceremony remains in the
explicit Rust fixture above; it verifies cookie binding and replay rejection.
