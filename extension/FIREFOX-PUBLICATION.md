# Firefox listed publication

This is a public AMO **listed** submission, not unlisted signing. Nothing is
published by a local build. Mozilla validation, review and listing approval are
separate from upload; a successful workflow is not proof of public availability.
Chrome and Safari publication are deliberately not implemented here.

## Reproduce from source

Build environment: Ubuntu 24.04, Node **22.23.4**, npm **10.9.9**, Python 3.12.
Install Node from https://nodejs.org/en/download and Python using the OS package
manager. No Rust, server build, private packages, secrets or service credentials
are needed. From the source archive root:

```sh
cd extension
npm ci --ignore-scripts
npm run check
npm test
npm run lint:firefox
python3 scripts/source-bundle.py
sha256sum dist/firefox.zip
```

`dist/firefox.zip` is the unsigned add-on. `dist/firefox-source.zip` contains the
human-readable TypeScript, generated API types, static assets, shared theme, icon notices,
exact dependency lock, build/test scripts and these instructions. No minifier or
remote code is used. The build emits deterministic sorted ZIP entries with fixed
timestamps. Rebuild the extracted source in a fresh directory and compare
`dist/firefox.zip` hashes or all extracted files. AMO signing adds metadata, so a
signed XPI is not expected to have the unsigned ZIP hash. `web-ext` is exactly
10.8.0 (registry integrity in the lock); its registry engine permits Node >=20,
while current Mozilla v10 documentation requires Node >=22. We use Node 22.

Only Firefox changes its consent declaration: URLs, page titles and the access token leave the browser for the
configured service, so `browsingActivity`, `websiteContent` (the title) and `authenticationInfo` (the
create-only token) are
required, **not** `none`. Desktop
minimum 140 uses Firefox's built-in consent. Android minimum 142 avoids claiming
old Android consent support; Android runtime/UI acceptance has not been performed.
The title is sent as link metadata and also used for HTML clipboard content. See the checked-in privacy
policy and metadata. The extension never collects background browsing history.

## One-time publisher setup (human action; not performed by CI)

1. Sign in to https://addons.mozilla.org/developers/ using the explicitly chosen
   publisher's Mozilla account. Create an account only if the owner chooses to.
   Complete email verification, the developer agreement and any required account
   security prompts. Check the public developer profile/display name before the
   first submission; API credentials publish as this account, not as GitHub.
2. Open https://addons.mozilla.org/developers/addon/api/key/ and generate personal
   API credentials. The JWT issuer is `WEB_EXT_API_KEY`; the JWT secret is
   `WEB_EXT_API_SECRET`. These are not an account password, GitHub token, or
   Shortener access token. Save them in a password manager; never put them in Git,
   workflow inputs, command-line arguments, screenshots, issues or logs.
3. In repository Settings → Environments create **firefox-addons**. Require human
   reviewers and prevent self-review where available. Restrict deployment refs to
   protected `extension-v*` tags, protect main, and restrict tag creation/deletion
   with repository rules. Store those two names as **environment secrets**, not
   general repository secrets. This environment is intentionally not configured
   by this change; missing credentials fail closed, never silently skip signing.
4. Confirm the stable manifest ID `shortener-companion@shortener.invalid` belongs
   to the intended publisher / is available. Review `amo-metadata.json`, consent,
   privacy policy, license and listing copy. No repository license was present;
   the conservative AMO choice is `all-rights-reserved`, not an invented open-source
   grant. Bundled Lucide paths retain their ISC/Feather notices. Change licensing only with owner
   approval. Prepare actual listing screenshots and accurate support details.
5. `amo-metadata.json` -> `version.approval_notes` contains runnable private
   reviewer instructions. The extension source archive includes
   `extension/reviewer-compose.yaml`, which pulls the immutable public server
   image for revision `783feaa68db35792e3b4b3570f73c4ee56a67113`. It exposes only
   loopback port 80 (service) and 8025 (Mailpit), explicitly admits internal
   plaintext SMTP and generates no shared credentials. Port 80 intentionally
   matches the hostname-only short-address contract: `HostName::parse` discards
   ports, so setting `SHORT_DOMAIN=localhost:3000` would not repair port-3000 links.
   The hosted reviewer smoke exercises the real admin/account/Mailpit/token flow,
   production extension HTTP adapter, emitted redirect, revocation and cleanup.
   It does not claim browser UI automation of the server account forms.

### Complete initial-listing transaction

The v5 create API requires explicit localized `name`, `summary`, categories and
version `license`. The authenticated `accounts/profile/` read must have the exact
owner-approved `display_name` **Aditya** before any write. No email address is
chosen, exposed or changed. The stable GUID/version and add-on must not already
exist: this first-listing adapter refuses automatic update/resume.

AMO's add-on create API requires an uploaded version; it cannot create an empty
listing and set policy/screenshots before version creation. Its create serializer
also does not accept `privacy_policy` (nested or top-level). The adapter therefore
creates the add-on **atomically developer-disabled** (`is_disabled: true`), reads
that hold and publisher ownership back, then attaches the accepted source ZIP.
AMO can begin reviewing the version during this hold, but cannot publicly enable
the add-on. This is a publication fence, not a claim to delay AMO's review queue.

The adapter PATCHes `{privacy_policy: <approved localized text>}` to
`addons/addon/{guid}/eula_policy/` and reads its exact unsanitized value back.
It uploads each approved PNG to `previews/` as multipart `image`/`position`, then
PATCHes translated caption/position separately (AMO forbids captions in that
multipart upload). It waits only through bounded GET polling for exact preview
IDs, captions, dimensions and HTTPS image references. No write is retried.
The server may resize/recompress images; readback verifies the returned preview
records, not byte-identical server encoding. Local input hashes bind the actual
approved upload bytes. It rechecks source attachment, version/channel/license,
reviewer notes, publisher ownership, listing copy and policy before the sole
publication-enabling PATCH (`is_disabled: false`), whose effect is read back.
Incomplete policy/media/source or an unknown write outcome stops with the add-on
held disabled; no compensating enable, automatic resume, duplicate upload or
retry is attempted. An uncertain final enable requires manual reconciliation.

`extension/listing/assets.json` binds the approved restyled **actual native
Firefox** popup/settings captures to SHA-256 values, dimensions, captions and
original capture hashes. PNG/JPEG (non-animated) are the API's supported formats;
these stripped PNGs are 1280x800 and below 5 MiB each. The popup is cropped from
the real desktop capture, its ephemeral local address visibly masked, then
centered/enlarged; the blank Settings capture retains the shipped example
placeholder. Originals and masking provenance remain private evidence, not
source archive contents. The archive includes exactly the two public PNGs and
their manifest, never personal accounts, local capture paths or credentials.

References: [v5 add-on create](https://mozilla.github.io/addons-server/topics/api/addons.html#addon-create),
[policy API](https://mozilla.github.io/addons-server/topics/api/addons.html#addon-eula-policy),
[preview create/edit](https://mozilla.github.io/addons-server/topics/api/addons.html#preview-create).
The installed `web-ext` 10.8.0 `lib/util/submit-addon.js` also creates the version
before its source PATCH and forwards metadata without special privacy/media
handling. The scoped API adapter replaces that submission path rather than
pretending unsupported JSON fields or screenshot filenames upload themselves.

## Publisher authorization boundary

The GitHub repository identity is separate from the store publisher identity.
Do not infer a legal name, contact address or Mozilla account from GitHub or an
operator profile. Before any release tag or store write, the owner must explicitly
approve the intended publisher account and listing/contact metadata. If publisher
identity changes, replace the protected environment credentials with credentials
for the approved account first. Secret presence is not account verification or
publication authorization. Native acceptance is secret-free and does not validate
or use publisher credentials. No publisher credential values should be retrieved
for these tests.

## Release and dry run

The `Firefox extension` workflow runs build/type/unit/ZIP-lint/source-rebuild
verification first. A separate **secret-free native job** on standard GitHub
`ubuntu-24.04` then downloads that exact ZIP. It runs on PRs, main, the preparation
feature branch and manual dispatch, before and independently of release-tag
admission. The repository is public and already has an active Actions workflow;
no new runner service, purchase or paid runner is configured. Artifacts and native
evidence are retained 30 days.

Native execution uses official desktop Firefox **160.0.1** and geckodriver
**0.36.0**, with fixed URLs and SHA-256 values in
`scripts/native-toolchain.json`. The installer bounds download sizes, checks the
archive hashes before extraction and uses safe tar extraction. No AMO credentials
are available to build, native (including reviewer smoke) or release-admission jobs. npm dependencies remain
integrity-locked; Actions remain SHA-pinned.

The native receipt is generated by executed assertions, not a checked-in
`accepted` boolean. It records each required check and the unsigned ZIP SHA-256,
source SHA, GitHub run ID/attempt and exact browser version. Release admission
requires the native job's success **and** complete same-run native and self-hosted
reviewer-smoke receipts matching those identities. The latter additionally pins
the exact source-archive SHA-256 and immutable server image/revision and requires
all account/mail/token/request/
redirect/revocation/owned-cleanup checks. Missing, stale, partial, failed-cleanup and foreign-run receipts
fail closed. The old static `firefox-acceptance.json` seal is removed: runtime
execution can now produce acceptance without a manual source change.

After owner approval and merge, `extension/package.json`, both root versions in
its lockfile, and the generated Firefox manifest must match `extension-vX.Y.Z`.
Create that stable numeric tag only at a commit already in main. Server/Cargo/web
versions are independent products. Malformed, prerelease, mismatched and off-main
tags fail. Only a canonical tag push after successful verify/native/admission can
enter the protected `firefox-addons` submission job. PRs, forks, feature branches
and manual dispatch cannot enter it. Checkout never persists the GitHub token;
only the final submission step receives the two environment secrets. Signing
rechecks the receipt and downloads the accepted artifacts from the same run.

## Upload, review, publication and uncertain outcomes

Before writing, the signer authenticates an API v5 read of the exact GUID/version
and publisher profile. An existing version/add-on is a stop, not permission to
upload again. The API adapter uses the listed upload channel and the held
initial-listing transaction above, attaching the exact accepted source archive.
It does not wait for approval or claim public availability: its successful
result is submitted-not-publicly-verified. Inspect Developer Hub → Manage Status &
Versions for **uploaded**, **awaiting review**, **approved/public**, **rejected** or
**disabled** state. Verify the exact version is anonymously available on its
public AMO listing before announcing publication; an older public version does
not prove the new one is published.

Network errors/timeouts can occur after AMO accepted an upload. The script does
not retry writes. Workflow reruns (`GITHUB_RUN_ATTEMPT > 1`) are blocked from
submission. Before any new release attempt, inspect both Developer Hub versions
and API v5 `/addons/addon/{guid}/versions/{version}/` plus `/addons/upload/` for
unsubmitted uploads. Never blindly rerun, delete/recreate a tag, or interpret a
404 alone as proof that no upload occurred. Preserve AMO upload/version IDs in
private operator records, reconcile review state, and repair via the Developer
Hub if necessary. The workflow offers no manual signing bypass. Credentials,
AMO reads/writes and live publication have not been exercised by local tests.

## Actual Firefox acceptance

The headed Selenium harness installs the **real packaged ZIP** in a disposable
profile. It saves and forgets Settings, accepts the actual optional-host prompt using the visible inner native button
geometry and a real X11 click (not a non-rendered custom-element host click),
opens the real toolbar/Extensions-menu action, and checks a local fixture POST. The active
article is on `localhost`, while the service is on `127.0.0.1` at a distinct port.
The fixture asserts the actual URL/title, a dedicated test Bearer token and no
cookie, with a service cookie pre-seeded to make the observation meaningful.

The browser chrome context observes the actual native popup without resetting
frame focus or switching to content while native panels are open. The potentially
conflicting default keyboard shortcut is not used as acceptance authority. BiDi evaluates the
background Settings view's `browser.extension.getViews({type:'popup'})` without
activating that Settings tab or replacing the extension's adapters. Popup controls
are clicked through real X11 coordinates. `xclip` reads the system clipboard's
plain-text and HTML formats: plaintext must be only the short URL, HTML exactly
one title hyperlink. A transparent native-write observer verifies one actual
ClipboardItem per write with both formats. Native `text/markdown` is an optional
third representation only on explicit capability support; rejected third types
retry the original two formats. Missing capability support skips the optional
MIME, not rich copying. Native OS Markdown readback is recorded separately from
custom `web text/markdown` capability, which is never substituted. The separate
Copy Markdown action must produce exact escaped Markdown in the real plaintext
clipboard and is a required same-run receipt check. All copy actions remain
serialized and must leave the fixture POST count unchanged. A separately labeled forced-unavailable
ClipboardItem check exercises production's real copy-event fallback; native
clipboard sentinels before explicit plain and fallback copies prevent stale
content from passing. No clipboard payload is
injected by the harness to manufacture a pass. The final Forget assertion checks
both local credential removal and host-grant removal. Copy retries must leave the
fixture create count at one.

```sh
# Install xvfb, xauth, xdotool, xclip and Firefox GTK/audio dependencies with apt.
FIREFOX_TOOLS=/path/to/owned-tools python3 scripts/install-native-tools.py
FIREFOX_BIN=/path/to/owned-tools/firefox/firefox \
  GECKODRIVER=/path/to/owned-tools/geckodriver \
  EXTENSION_EVIDENCE=dist/native xvfb-run -a -s '-screen 0 1280x960x24' npm run test:firefox
```

The harness emits actual screenshots, native clipboard readbacks and
`firefox-runtime.json`; failed starts emit a failed/incomplete receipt instead.
WebDriver's chrome-window screenshots omit separate native popup panels.
`desktop-native-popup*.png` uses an actual full X11 root-window capture while the
panel is open, so it includes the visible popup. ImageMagick is a test-only
system dependency; neither it nor browser drivers are packaged in the add-on.
The native job also asserts the popup's computed app typography/theme/control
geometry. Chromium rendering acceptance separately captures light/dark and narrow
states of the actual native popup target, not an ordinary browser tab.
No live account, live service token, AMO API call or external service fixture is
used. Fixture values are deliberately non-secret test data. The test-only
geckodriver `--allow-system-access` flag allows browser-chrome control, not a normal
extension installation requirement. Pinned Firefox 160 additionally reads
`MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`; the harness grants this only in the owned
geckodriver/browser child environment, while preserving its X11 environment.
It is not an AMO credential, static acceptance boolean or production setting.

**Execution status:** local native acceptance is blocked: the admitted sandbox
aborts official Firefox 160.0.1 and 140.0 ESR before extension installation with
`wasm_rt_syscall_set_segue_base error: Invalid argument`, consistent with missing
`arch_prctl(ARCH_SET_GS)` support (https://github.com/google/gvisor/issues/11567).
Disabling the OS content sandbox does not fix RLBox/Segue. This is not an extension
compatibility verdict. GitHub-hosted native acceptance was executed successfully at revision
`78ffd6a4125e665989a543a33f474c255de0d4b7`:
https://github.com/lucination/shortener/actions/runs/44202391024 . That historical
pass does not accept later source or package changes. Every revision, including
UI restyles, must produce its own successful same-run, hash-bound native receipt. Source/unit/syntax checks
are not reported as native toolbar or clipboard acceptance. Do not weaken the
manifest minimum or label a failed startup as a pass.

## Official references

- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://addons-server.readthedocs.io/en/latest/topics/api/addons.html
- https://addons.mozilla.org/developers/addon/api/key/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://mozilla.github.io/addons-server/topics/api/licenses.html
