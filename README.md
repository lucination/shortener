# Shortener

Native Rust Loco + SQLite, with two independently built static SvelteKit applications.
The user workspace is `/`; administration is `/_/` (enter the URL manually).
User APIs are `/api`; administrator APIs are `/_/api`, with separate session cookies.
`GET /{short}` returns HTTP302 directly, including for curl and browsers without JavaScript.
Password and preview/continue gates are server-rendered and do not disclose protected destinations.

## Container POC

Prerequisites: Docker with Compose. Generate secrets in your local shell; never commit them:

```sh
export ADMIN_TOKEN="$(openssl rand -hex 32)"
export ANALYTICS_SECRET="$(openssl rand -hex 32)"
docker compose up --build
```

Open `http://localhost:3000/_/`, sign in with `ADMIN_TOKEN`, and add an account.
Open `http://localhost:3000/` and request a sign-in link for that account.
Development mail is captured in Mailpit at `http://localhost:8025`; no external email is sent.
The runtime image contains the native application and both static builds, **not Node or Vite**.
SQLite data is in the `shortener-data` volume. Do not discard it to reset an account.

The Compose file is local-only POC configuration, not a production deployment recipe.
Use the intended HTTPS `APP_ORIGIN` for non-local hosting and WebAuthn. SMTP currently targets an
unauthenticated trusted relay; external relay deployment and credentials are deliberately out of scope.

## Native build and checks

```sh
npm ci --prefix web
npm ci --prefix admin
cargo run --locked --bin export-contracts
npm --prefix web run sync-contracts
npm --prefix web run check-contracts
npm --prefix web run check
npm --prefix web test
npm --prefix admin run check
npm --prefix web run build
npm --prefix admin run build
cp -r admin/build web/build/_
cargo test --locked -j1
cargo fmt --all --check
```

Admin explicitly shares the controlled components and checked, generated DTO boundary in
`web/src/lib`; it does not mount the user application. Presentation has no session, storage or API
effects. Each application owns its container and authority. Storybook mounts only controlled
presentation with props/callbacks. Attribution is in `web/THIRD-PARTY-NOTICES.md`.
The product follows system light/dark settings only; no theme preference is stored.

## Runtime environment

Required: `DATABASE_PATH`, `APP_ORIGIN`, `ADMIN_TOKEN`, `ANALYTICS_SECRET`.
Tokens/secrets must contain at least32 bytes. Optional settings:

| Setting                               | Default / behavior                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `SHORT_DOMAIN`                        | `example.com`; configured hostname, not arbitrary forwarded hosts                         |
| `STATIC_DIR`                          | `web/build`; admin build must be at its `_` subdirectory                                 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | local relay,1025, `login@SHORT_DOMAIN`                                                   |
| `TRUSTED_PROXIES`                     | empty; comma-separated exact peer IPs allowed to supply forwarding headers               |
| `GLOBAL_RETENTION_DAYS`               | 90; whole number1..3650; link overrides account overrides global                         |
| `GEOIP_MMDB`                          | absent: honest null country/city; optional local MaxMind City MMDB, no runtime downloads |
| `DEV_VITE_ORIGIN`                     | absent; loopback HTTP only, rejected outside development                                 |

Start with environment already loaded:

```sh
cargo run --locked --bin shortener -- start --binding 127.0.0.1 --port 3000 --no-banner
```

Raw event responses are bounded to the latest1000 events plus the total retained matching count;
they are not a complete historical export or a paginated API. Permanent daily aggregates remain
after raw-event pruning. Daily unique counts are not multi-day distinct people.

## Local development

Use loopback services with separate test data and environment-backed secrets.
The optional Caddy configuration keeps API and short-route authority in Rust while proxying Vite.

