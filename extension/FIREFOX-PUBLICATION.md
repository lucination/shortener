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

### Privacy disclosure

Shortener Companion connects only to the self-hosted Shortener instance you configure. When you shorten a page, its URL and title are sent to that instance using your access token. The instance address and token are stored locally in your browser. The extension developer receives no data or telemetry. Data stored by your instance is under your control.

### Official web-ext submission, not a custom write protocol

The only writer is the existing integrity-locked **web-ext 10.8.0 CLI**. After
release admission and authenticated read-only publisher/GUID/version preflight,
the protected job executes the equivalent of:

```sh
node node_modules/web-ext/bin/web-ext.js sign \
  --source-dir dist/firefox --channel listed \
  --amo-metadata amo-metadata.json \
  --upload-source-code dist/firefox-source.zip \
  --approval-timeout 0 --timeout 300000 \
  --artifacts-dir dist/amo-cli --no-config-discovery --no-input
```

Credentials are supplied only through the existing protected step environment,
never arguments. There is no npx download, dependency change, home/project config
discovery, verbose log, proxy override, custom upload/create/policy/preview client
or custom disable/enable sequence. The thin process wrapper captures at most
64 KiB of output, emits only sanitized stage/status/known field paths and codes
or message classifications, and stops the child after nine minutes. It never
prints or retains raw CLI/provider output. The CLI timeout bounds validation GET
polling; it is not an HTTP request/body limit. Only our independent read-only
client retains the 1 MiB decoded JSON/30-second bounds. Upstream CLI networking is
not patched or falsely described as using those bounds.

Pinned implementation facts: sign reads the metadata JSON unchanged. With the
stable manifest GUID, it uploads and validates, then uses the v5 **PUT**
`addons/addon/{guid}/` create-or-update route, followed by a version source PATCH.
The provider routes a missing-record PUT through its create serializer. Categories
are not converted from an array to an application object; the approved object is
passed exactly as checked in. Reviewer notes and the all-rights-reserved license
are forwarded under version metadata. No approval wait or signed-XPI download is
performed when approval-timeout is zero. A CLI success does not establish review
approval or public availability.

The read-only preflight requires the approved display name **Aditya** and stops
on an existing exact version or add-on. Because the official route is an upsert,
this observation is not an atomic reservation: the owner must not run competing
publisher/Developer Hub mutations during the transaction. No takeover or update
is deliberately authorized by the preflight. The stable ID remains
`shortener-companion@shortener.invalid`.

**Native artifact binding:** the CLI always rebuilds a ZIP from its directory.
The source directory is first checked for exact file inventory and byte equality
against every entry of the same-run, hash-bound native-tested `dist/firefox.zip`.
Symlinks, changed/extra files and saved `.amo-upload-uuid`/`.web-extension-id` caches
are rejected. The pinned CLI loopback contract test verifies that its actual
uploaded ZIP contains those exact files and its source PATCH contains the exact
accepted source archive. ZIP headers, entry order and compression differ: we do
not claim the repacked upload has the deterministic native ZIP container hash.
The reproducible native ZIP and source archive hashes remain authoritative inputs.

### Metadata length admission before upload

AMO approval notes are a **string limited to 3,000 Unicode code points**, not
5,000 characters. The pinned provider
[Version model](https://github.com/mozilla/addons-server/blob/6e31cf033455eeaf68c5e6b689f5f917f9faf69f/src/olympia/versions/models.py#L309-L313)
declares `TextField(max_length=3000)`; its writable
[DeveloperVersionSerializer](https://github.com/mozilla/addons-server/blob/6e31cf033455eeaf68c5e6b689f5f917f9faf69f/src/olympia/addons/serializers.py#L469-L530)
and AMO model-serializer mixin inherit/enforce that limit. An isolated execution
of the actual pinned field, mixin and get_fields with the provider-pinned Django
5.2.19 / DRF 3.18.3 accepted 2,999/3,000 code points and rejected 3,001 and the
former 5,274-character note with `max_length`. It also verified astral Unicode
counting. This is a field-level oracle, not a captured production response or
full AMO server deployment.

`node scripts/check-amo-metadata.mjs` is a secret-free local check and the first
verify-job gate. The same validation runs in the publisher before authenticated
preflight or CLI invocation. It requires a primitive string, counts code points
without trimming or truncating approved text, and emits only field/code/limit/
actual-count diagnostics. This admission currently targets approval_notes;
it is not a claim to validate every AMO metadata rule.

The concise submitted note stays below 2,000 characters and points to the
**Self-hosted reviewer setup** section in this attached document. The complete
tested setup, commands and UI controls are preserved there rather than dropped
or sent as an over-limit field. Actual pinned-CLI loopback tests cover the
provider-derived 2,999/3,000/3,001 boundary and sanitized nested field rejection.
They do not upload to AMO or treat constructed responses as live observations.

### Required Developer Hub completion after the CLI

This is **not** a manual-first-listing path: the official CLI creates the listing.
It does not call the policy or screenshot APIs. Unsupported `privacy_policy` has
been removed from CLI metadata, not silently treated as applied. The exact
approved disclosure is preserved in `listing/privacy-policy.txt` above and in the
source archive. The two approved actual Firefox screenshots, hashes, dimensions
and captions remain in `listing/{popup.png,settings.png,assets.json}`.

The supported metadata field **is_disabled: true** requests a developer-disabled
listing through the official CLI itself. A GET-only readback must verify the
held listing, approved owner, exact listed version and attached source before the
script reports submitted-developer-disabled. No code enables it. Mozilla can
begin reviewing during this hold; it is not a delayed-review promise.

Before public enabling, the approved account owner must:

1. Open the existing CLI-created Shortener Companion in Developer Hub, not Submit
   a New Add-on. Verify the stable GUID, exact version, display name Aditya,
   developer-disabled state, attached source, reviewer instructions, approved
   listing copy and all-rights-reserved license. Do not invent a contact email.
2. In **Manage Authors & License**, select **This add-on has a privacy
   policy** and paste the complete `listing/privacy-policy.txt` into **Privacy
   Policy**. Save, reopen and compare the saved text with that file, not merely a
   policy URL. Use **Save Changes**, then reopen the policy form to verify it.
3. On **Edit Product Page**, use **Edit** in **Add-on Media** and **Add a Screenshot...**.
   Upload **popup.png first,
   settings.png second**, both 1280x800 PNGs. Set the English captions to the exact
   `caption.en-US` strings in `listing/assets.json`, retain that order and use **Save Changes**.
   Reopen the page to verify both images, captions and order. These are approved
   real captures; the popup address is visibly redacted. Do not substitute fixture
   screenshots or claim server recompression preserves the uploaded PNG hashes.
4. Only after those saved values and version/source details are verified, use the
   existing listing enable control in **Manage Status & Versions**. Keep any
   Mozilla-disabled or rejected record stopped for review; do not attempt to
   override it. Verify the enabled state and review outcome, and then the exact
   version on the anonymous public listing before announcing publication.

These manual operations are required, not reported as CI-completed policy/media
work. Metadata requests the hold; the readback establishes whether it took effect.
See the pinned provider templates and current Developer Hub labels if navigation
changes. No API keys or account data need to be copied into chat.

Navigation and field labels are grounded in the pinned
[owner/policy template](https://github.com/mozilla/addons-server/blob/6e31cf033455eeaf68c5e6b689f5f917f9faf69f/src/olympia/devhub/templates/devhub/addons/owner.html),
[media form](https://github.com/mozilla/addons-server/blob/6e31cf033455eeaf68c5e6b689f5f917f9faf69f/src/olympia/devhub/templates/devhub/addons/forms_shared/media.html)
and [edit navigation](https://github.com/mozilla/addons-server/blob/6e31cf033455eeaf68c5e6b689f5f917f9faf69f/src/olympia/devhub/templates/devhub/includes/addons_edit_nav.html).

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

Every write is owned by the official CLI. It has no upload/create/source write
retry loop; validation GET polling is not a write retry. The wrapper invokes the
CLI once. An error, output overflow, child timeout, source failure or incomplete
held readback stops for reconciliation. Workflow attempt 2 remains forbidden;
there is no manual signing bypass. Official upload cache files created during an
attempt are not permission to resume and are never seeded into a fresh source
directory. Preserve useful IDs privately, not in public source control.

The HTTP 400 from the former custom adapter has no retained provider body, so its
cause is **unknown**. This migration does not retroactively diagnose it. Loopback
fixtures prove real CLI PUT/source behavior and safe field/code diagnostics; they
are synthetic contract tests, not captured live responses. The later official-CLI
approval_notes field failure is explained by the confirmed 3,000-character limit
above; the former 5,274-character value fails locally before any new upload.
Before another live
attempt, inspect current authenticated GUID/version/upload state and existing
Developer Hub validation details. Do not infer absence from anonymous or
not-found-or-not-visible results, and do not bump a version to hide an unknown
outcome. After correcting that proven field defect, the current candidate is
**0.1.4**, for a parent-reviewed
`extension-v0.1.4` tag and new attempt 1. These observations are not global absence
proof: the normal authenticated publisher/GUID/version preflight remains mandatory.
Previous uploads are neither reused nor deleted, and prior release tags remain immutable.
Never rerun, move or delete an existing failed tag.

The separate manual **Firefox AMO read-only reconciliation** workflow is retained.
It is canonical-main-only, credential-isolated and GET-only, and cannot invoke the
submit entrypoint. It checks the approved publisher and exact GUID/version, reads
at most four pages of 25 owned uploads and optionally one exact compact upload ID,
and reports explicit scanned/total/truncated coverage. Provider-default ordering
is not a recency guarantee. It emits no filenames, validation bodies, personal
fields, response URLs or download tokens. Every read retains its 1 MiB/30-second
bound. The v5 upload serializer uses UUIDField(format=hex); the diagnostic parser
preserves exactly 32 lowercase hex characters without repair.

Upload inventory does not establish byte identity: v5 omits the stored hash, GUID
binding and private raw-download access token. Existing-upload reuse would need
separate independent proof and authorization; no reuse path is implemented here.
An explicitly authorized fresh transaction is distinct and need not prove bytes
of an unused orphan. Prior uploads remain untouched. A zero-step environment
rejection is also distinct from a write failure; retain that evidence without
weakening attempt-one admission or treating any provider state as absent.

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

## Self-hosted reviewer setup

The complete tested setup is preserved here; AMO receives only the concise pointer and checklist.

Shortener Companion is a client for a self-hosted service, not a developer-operated shortening service. No hosted demo or shared login/token is supplied. Reviewers can create their own local instance and account.

SERVER SETUP: From the attached source archive root, use Docker with Compose and OpenSSL on a native amd64/arm64 machine. The source archive does not contain the server sources: the included local-only extension/reviewer-compose.yaml pulls the immutable image ghcr.io/lucination/shortener@sha256:77b47988296ee9dca25f3f4deba84e4fd7064922d8823ca4e6b73a5597266d6a (public server revision 783feaa68db35792e3b4b3570f73c4ee56a67113). Free local port 80 and port 8025 first; Docker must be allowed to bind loopback port 80. This keeps the service origin and emitted short URLs at http://localhost with no missing port. No Rust or server build is required.

```sh
export ADMIN_TOKEN="$(openssl rand -hex 32)"
export ANALYTICS_SECRET="$(openssl rand -hex 32)"
docker compose -f extension/reviewer-compose.yaml config --quiet
docker compose -f extension/reviewer-compose.yaml up -d --wait
```

Retain ADMIN_TOKEN locally (inspect it with printenv ADMIN_TOKEN in that same shell) for the admin sign-in below. Do not share or commit it. The recipe explicitly permits plaintext SMTP only on the isolated local Compose network to Mailpit. It is not a public deployment recipe. The secret-free hosted reviewer smoke executes admin/account creation, Mailpit sign-in, token issuance, the actual production extension HTTP adapter, the emitted short URL redirect, revocation and cleanup against this pinned image. The separate native Firefox job tests actual toolbar/clipboard interactions. No developer credentials are needed for either test.

ACCOUNT: Open http://localhost/_/ in desktop Firefox and sign in using your generated ADMIN_TOKEN. Choose Users -> Add user, enter an address you choose in Email address and press Confirm. No deliverable or personal email address is required: all mail stays in local Mailpit. Open http://localhost/, enter that same address in Email and press Send sign-in link. Open http://localhost:8025 and open the captured message's sign-in link in the same Firefox profile. No passkey enrollment is required.

TOKEN: In the signed-in workspace open Account -> Access tokens. Set Token name to Firefox review, retain the default expiry (90 days), press Create access token and Copy token. Save the one-time value before leaving Account. This dedicated create-only token is not the administrator token or a session cookie.

EXTENSION: Install the submitted add-on in desktop Firefox 140 or newer and accept Firefox's declared data-transmission consent (browsing activity, website content/page title, authentication information/access token). Open Settings (also available through about:addons -> Shortener Companion -> Preferences). Set Service URL to http://localhost and Access token to your newly issued token; press Save and allow the localhost host permission. HTTP is accepted only for loopback. Non-local hosting requires an HTTPS origin without a path. Credentials are stored locally, not synced.

REVIEW: Open an ordinary HTTP(S) page (not about:, an AMO page or another protected Firefox page) and invoke the toolbar action. Opening the popup sends its URL/title and the token only to the configured service via POST /api/links, creates one link and attempts to copy its URL. If automatic clipboard access is denied, use Copy URL. Clicking the page title copies an HTML hyperlink with URL-only plaintext; it does not navigate. Copy Markdown is a separate explicit plaintext action; native Markdown MIME is optional and capability-dependent. Copy retries within the same popup do not create more links. Reopening the popup creates another link, so check the service's Links workspace after any uncertain request outcome. The emitted short address can be opened directly in this local port-80 setup.

CLEANUP: Forget settings removes local credentials and host access, not server tokens/links. Use Account -> Access tokens -> Revoke for the review token. Run docker compose -f extension/reviewer-compose.yaml down to stop the local instance; do not add -v unless deliberately deleting this disposable instance's saved data.

SERVER SOURCE: Public source and README are at https://github.com/lucination/shortener/tree/783feaa68db35792e3b4b3570f73c4ee56a67113 . For optional inspection in a separate directory:
```sh
git clone https://github.com/lucination/shortener.git shortener-review
cd shortener-review
git checkout --detach 783feaa68db35792e3b4b3570f73c4ee56a67113
```
Run that checkout command inside shortener-review. This full server checkout is separate from the extension-only archive and not required to run its immutable image.

ADD-ON SOURCE: TypeScript sources, exact dependency lock, deterministic source-build instructions, the local reviewer Compose recipe and clean public listing screenshots are attached. See extension/FIREFOX-PUBLICATION.md, Reproduce from source. Rebuilding the add-on needs no Rust, Docker or service credentials. Screenshots are actual native Firefox captures; the popup's local test address is visibly redacted. Android runtime/UI acceptance is not claimed. Lucide icons retain their bundled ISC/Feather notices.

## Official references

- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://addons-server.readthedocs.io/en/latest/topics/api/addons.html
- https://addons.mozilla.org/developers/addon/api/key/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://mozilla.github.io/addons-server/topics/api/licenses.html
