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
Use the intended HTTPS `APP_ORIGIN` for non-local hosting and WebAuthn. Authenticated SMTP relay
configuration is supported; relay deployment and credential acquisition are separate operator steps.

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
| `SMTP_SECURITY` | `plain` only by default for loopback; otherwise explicitly `starttls`, `tls`, or `plain` for a trusted internal relay |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | both absent (Mailpit) or both nonempty; partial/empty credentials reject startup |
| `TRUSTED_PROXIES`                     | empty; comma-separated exact peer IPs allowed to supply forwarding headers               |
| `CLIENT_IP_HEADER`                    | `x-forwarded-for`; alternatively `cf-connecting-ip`; any other value rejects startup      |
| `GLOBAL_RETENTION_DAYS`               | 90; whole number1..3650; link overrides account overrides global                         |
| `GEOIP_MMDB`                          | absent: honest null country/city; optional local MaxMind City MMDB, no runtime downloads |
| `DEV_VITE_ORIGIN`                     | absent; loopback HTTP only, rejected outside development                                 |

Client-IP headers are ignored unless the immediate socket peer is in `TRUSTED_PROXIES`.
The default policy preserves the first `X-Forwarded-For` address and is safe only when
the admitted proxy sanitizes that chain. For Cloudflare Tunnel, explicitly select
`CLIENT_IP_HEADER=cf-connecting-ip`: only a single valid `CF-Connecting-IP` is used
for analytics and rate limits; missing, malformed or repeated values fall back to
the socket peer, never to `X-Forwarded-For`. The edge must overwrite this header
with the actual visitor address (not preserve an attacker-supplied value). Disable
any edge rewriting that substitutes a pseudo visitor IP if real IPs are required.
Bind the application to loopback and admit only the exact measured immediate proxy
peer in `TRUSTED_PROXIES` (which can differ from loopback with container networking).
Never trust all peers or expose a bypass to the admitted proxy path. Anyone able to
connect through that trusted peer can otherwise forge visitor identity. This policy
does not change the existing trusted `X-Forwarded-Host` behavior.

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


## Production SMTP

For an authenticated SMTP relay, set both `SMTP_USERNAME` and
`SMTP_PASSWORD` to the relay's configured AUTH credentials. They are not a SimpleLogin mailbox
login and must not be committed or supplied as build arguments. Keep the runtime environment file
operator-owned and mode `0600`. Set `SMTP_HOST`, `SMTP_PORT`, and an authorized `SMTP_FROM`.

Use `SMTP_SECURITY=starttls` for mandatory STARTTLS, or `tls` for implicit TLS. Both validate the
certificate chain and hostname using the built-in public roots; there is no insecure-certificate
switch or opportunistic plaintext fallback. A remote host with no explicit security mode rejects
startup. `plain` is an explicit trust declaration **only for a local/private protected relay hop**;
it sends the AUTH credentials unencrypted and must never be used across an untrusted network.
For example, an isolated internal relay without TLS needs `SMTP_SECURITY=plain` explicitly.
The local Mailpit defaults remain `127.0.0.1:1025`, plaintext, and no credentials.

SMTP socket operations have a five-second timeout. Delivery failure keeps the existing generic
magic-link response (no account enumeration) and emits a credential-free warning; a successful
HTTP response does not prove email delivery. Tests use an isolated loopback AUTH relay; actual
production delivery remains a deployment acceptance step after credentials are provided.

## Multiarchitecture container builds

`Dockerfile` supports `linux/amd64` and `linux/arm64`. Node and Rust always execute on
`BUILDPLATFORM`; Rust cross-links with the target GNU compiler, libc headers and OpenSSL. The
target Debian runtime has **no RUN instructions**, so no binfmt/QEMU is required. It contains the
binary, public CA roots, OpenSSL runtime libraries, both SPAs and a writable data directory owned
by numeric UID/GID `10001:10001`, not Node or build tools. Bind mounts must preserve that ownership.
Base multiarch index digests, npm locks and Cargo.lock pin the language inputs; Debian apt packages
come from the Bookworm repositories (not a time-frozen snapshot, so this is not byte-reproducible).

Fast prerequisites-only probes (do not build the application or release image):

```sh
docker buildx build --network=host --platform linux/arm64 --target cross-probe .
docker buildx build --network=host --platform linux/amd64 --target cross-probe .
```

They compile C and Rust probes against target OpenSSL and inspect ELF architecture/dependencies.
They do not execute the foreign binary or establish full application/production acceptance.
The ui target independently builds and combines both SPAs using native Node:
`docker buildx build --network=host --platform linux/arm64 --target ui .`.

For an authorized release, use clean reviewed `main` matching `origin/main`, then supply the exact
revision label. Example single-architecture local archive:

```sh
docker buildx build --network=host --platform linux/arm64 \
  --build-arg VCS_REF="$(git rev-parse HEAD)" --load -t shortener:REVIEWED_REVISION .
```

Build/publish an index with `--platform linux/amd64,linux/arm64 --push` using a task-owned
docker-container builder; Docker's default classic store cannot load a multiarch index. In a task
box where only host-network DNS works, create the builder without changing the shared daemon:

```sh
docker buildx create --name shortener-task-builder --driver docker-container \
  --driver-opt network=host --buildkitd-flags '--oci-worker-net host' --bootstrap
docker buildx build --builder shortener-task-builder --network=host \
  --allow network.host --platform linux/amd64,linux/arm64 \
  --build-arg VCS_REF="$(git rev-parse HEAD)" --push -t REGISTRY/shortener:REVIEWED_REVISION .
```

No credentials belong in the image. Inspect each published platform's architecture, revision,
dynamic-library closure, static assets and nonroot data writes; run the actual ARM64 application
on the destination (or an explicitly admitted emulator) before switching production.
