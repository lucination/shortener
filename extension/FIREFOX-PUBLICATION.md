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

The `Firefox extension` workflow verifies pull requests and main without AMO
secrets. Manual dispatch is **build-only** and cannot publish. Verification builds,
tests, type-checks, lints the actual Firefox ZIP with warnings as errors, and
archives the ZIP and sources. Artifacts are retained 30 days.

After owner approval and merge, all four relevant versions must match:
`extension/package.json`, both root versions in its lockfile, and the generated
Firefox manifest. Create `extension-vX.Y.Z` only for that exact version at a commit
already in main. Server/Cargo/web versions are independent products. Stable numeric
triples only; malformed, prerelease, mismatched and off-main tags fail. A tag push
in the canonical repository alone can enter the protected signing job **after**
verification succeeds. PRs/forks/manual dispatch cannot enter it; checkout never
persists the GitHub token. Actions are pinned by SHA and npm by lock integrity.
The signer downloads the verified artifacts from the same workflow run and lints
again before loading AMO secrets into the one submission step.

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

The Selenium prerequisite probe starts desktop Firefox, installs the **real built
ZIP**, and opens its real settings page in a disposable profile. It does not
substitute Chromium or mocked extension APIs. Run with an X server (or Xvfb):

```sh
FIREFOX_BIN=/path/to/firefox GECKODRIVER=/path/to/geckodriver \
  EXTENSION_EVIDENCE=/path/to/evidence xvfb-run -a npm run test:firefox
```

Use geckodriver 0.36.0 and Firefox >=140. The test-only
`-remote-allow-system-access` flag permits browser-chrome follow-up; it is not a
user installation requirement. The prerequisite probe is **not full acceptance**:
actual native toolbar popup → active tab → local fixture short URL → clipboard
plain-text and HTML readback remains a release gate. Check Settings save/Forget,
optional service-origin permission, Bearer-only request without cookies, one URL
in text/plain, and title hyperlink in text/html. Use the native toolbar/shortcut,
not direct popup-tab navigation. Preserve screenshots and observed native
clipboard formats in private execution evidence. Never announce Firefox
compatibility merely because the probe or Chromium passes.

The admitted sandbox could not start official Firefox 160.0.1 or 140.0 ESR:
`wasm_rt_syscall_set_segue_base error: Invalid argument`, consistent with missing
`arch_prctl(ARCH_SET_GS)` support in a sandbox runtime. Both fail before extension
installation; disabling the OS content sandbox did not fix it. See
https://github.com/google/gvisor/issues/11567 for the distinct runtime issue.
This is an **unfulfilled Firefox runtime gate**, not evidence that the extension
is broken or compatible. Do not weaken the manifest minimum, patch Firefox, or
claim clipboard acceptance to bypass it. Repeat native acceptance in an approved
compatible environment before releasing. `firefox-acceptance.json` is a fail-closed
release seal: it deliberately remains `accepted: false`. After real native popup
and both clipboard-format readback pass, bind its version and unsigned ZIP SHA-256
to the observed artifact in a separately reviewed change. The release policy
checks that exact hash; neither credentials nor a manual dispatch bypass it.
Until then build-only CI can pass, but release-tag admission fails intentionally.

## Official references

- https://extensionworkshop.com/documentation/develop/web-ext-command-reference/
- https://addons-server.readthedocs.io/en/latest/topics/api/addons.html
- https://addons.mozilla.org/developers/addon/api/key/
- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://mozilla.github.io/addons-server/topics/api/licenses.html
