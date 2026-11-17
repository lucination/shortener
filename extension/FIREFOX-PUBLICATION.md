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
human-readable TypeScript, generated API types, static assets, font license,
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

1. Sign in to https://addons.mozilla.org/developers/ using the intended Lucination
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
   grant. Bundled fonts keep their OFL terms. Change licensing only with owner
   approval. Prepare actual listing screenshots and accurate support details.
5. Provide reviewers a reachable compatible service/test account through AMO's
   private reviewer notes if requested. Do not commit a live service, token,
   account identity or deployment path. Sources/build are reproducible without
   one; interactive shortening requires the service. Listing assets and reviewer
   access are human submission readiness gates, not fabricated automation output.

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
are available to build, native or release-admission jobs. npm dependencies remain
integrity-locked; Actions remain SHA-pinned.

The native receipt is generated by executed assertions, not a checked-in
`accepted` boolean. It records each required check and the unsigned ZIP SHA-256,
source SHA, GitHub run ID/attempt and exact browser version. Release admission
requires the native job's success **and** a complete same-run receipt matching
those identities. Missing, stale, partial, failed-cleanup and foreign-run receipts
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

Before writing, the signer authenticates an API v5 read of the exact GUID/version.
An existing version is a stop, not permission to upload again. `web-ext sign`
uses `--channel listed`, the listing metadata and matching source archive.
Approval wait is zero: the upload may be awaiting review. The signer reads back
that exact version, reporting channel, raw file status and disabled flag; no
successful upload is labeled published. Inspect Developer Hub → Manage Status &
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
opens the real toolbar shortcut, and checks a local fixture POST. The active
article is on `localhost`, while the service is on `127.0.0.1` at a distinct port.
The fixture asserts the actual URL/title, a dedicated test Bearer token and no
cookie, with a service cookie pre-seeded to make the observation meaningful.

The browser chrome context observes the actual native popup. BiDi evaluates the
background Settings view's `browser.extension.getViews({type:'popup'})` without
activating that Settings tab or replacing the extension's adapters. Popup controls
are clicked through real X11 coordinates. `xclip` reads the system clipboard's
plain-text and HTML formats: plaintext must be only the short URL, HTML exactly
one title hyperlink. A transparent native-write observer verifies one actual
ClipboardItem with both formats. A separately labeled forced-unavailable
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
compatibility verdict. The newly committed GitHub-hosted native job must execute;
its result is pending until an actual run is observed. Source/unit/syntax checks
are not reported as native toolbar or clipboard acceptance. Do not weaken the
manifest minimum or label a failed startup as a pass.

## Official references

- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://addons-server.readthedocs.io/en/latest/topics/api/addons.html
- https://addons.mozilla.org/developers/addon/api/key/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://mozilla.github.io/addons-server/topics/api/licenses.html
