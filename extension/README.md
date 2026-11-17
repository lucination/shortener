# Shortener Companion

A small Manifest V3 toolbar popup, built from one TypeScript source for Chrome,
Firefox and Safari. Opening the popup creates a link for the active HTTP(S) page
in your account and tries to copy **only the short URL**. The page title is a link
to that short URL; clicking it **copies, never navigates**: `text/html` contains a
formatted title hyperlink and `text/plain` contains `Title (short URL)`.

If automatic clipboard access is denied, the created link stays visible. Use
**Copy URL** to retry without another create request. A formatted-copy failure is
reported separately; Copy URL remains available. Reopening the toolbar popup
creates a new link, so do not reopen to retry a copy. Closing during a request can
leave a successfully created link without a displayed result. Check your account
before retrying after a timeout, disconnect, redirect or malformed response.

## Build and install

From the repository root, with Node 22 and Python 3:

```sh
npm ci --prefix web --no-audit --no-fund
npm run check --prefix extension
npm test --prefix extension
```

The build emits `extension/dist/chrome/`, `firefox/`, `safari/` and one
deterministic ZIP per platform. There is no separate extension dependency tree or
lockfile: TypeScript and test tooling come from the pinned web lockfile. Outputs
are ignored; no credentials or settings are bundled.

- **Chrome/Chromium:** open `chrome://extensions`, enable Developer mode, choose
  Load unpacked and select `extension/dist/chrome`. Pin the toolbar action.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, Load Temporary Add-on,
  and select `extension/dist/firefox/manifest.json`. Temporary installs disappear
  on restart. A normal distribution needs Mozilla signing. The sample Gecko ID
  must be replaced with the publisher's chosen ID before store publication.
  Store privacy/data-transmission declarations also require publisher review:
  this extension sends the chosen page URL/title and user credential to the
  explicitly configured service. The development manifest does not assert that
  no data is transmitted or claim completed store-policy compliance.
- **Safari:** the ZIP/directory is **Web Extension converter input, not an
  installable Safari app**. On macOS with Xcode, run:

  ```sh
  xcrun safari-web-extension-converter extension/dist/safari \
    --project-location safari-project --app-name 'Shortener Companion' \
    --bundle-identifier com.example.shortener-companion
  ```

  Choose your own bundle identifier/team. Open the generated Xcode project,
  inspect converter warnings and entitlements, set signing for the containing
  app and extension targets, build/run the macOS app, then enable the extension
  in Safari Settings → Extensions. Local unsigned development may require
  Develop → Allow Unsigned Extensions. iOS/iPadOS needs the generated containing
  app installed on a device and separately enabled in Safari; a desktop ZIP
  cannot be sideloaded directly. App Store signing/review is a separate task.
  Conversion, signing, Safari permission/clipboard behavior and pasting into
  Apple Notes require macOS/device verification; Linux tests do not prove them.

The suggested shortcut is Ctrl+Shift+Y (Command+Shift+Y on macOS). Browser or OS
conflicts can leave it unassigned; use the toolbar or assign a shortcut in your
browser's extension settings.

## Service and authentication

Open **Settings** in the popup (or the browser's extension options). Enter the
service origin, such as `https://short.example`, and **your user session token**.
HTTPS is required except for `http://localhost`, `127.0.0.1` or `[::1]` development
services. Do not enter a path, credentials, query or fragment. The origin is an
explicit trust decision: only configure a service you control/trust.

This repository has **no existing user API-token issuance facility**. Its existing
account authority is the expiring, revocable `short_session` cookie. This change
adds a deliberately narrow adapter: **only `POST /api/links`** accepts that same
user-session value as `Authorization: Bearer …`. It still uses the existing user
authentication, account status, ownership, quota and transactional store scope.
There is no new long-lived token type, CORS relaxation or admin-token support.
Other mutation routes retain their same-origin cookie/CSRF policy. Deploying this
server change is required before an older server can accept the extension.

To configure manually, sign in to the user application, open your browser's
developer tools → Application/Storage → Cookies for the service, and copy the
**value** of `short_session` into the extension's password field. Do not include
`short_session=`. Do not use `short_admin`, an admin login secret, or a magic-link
token. HttpOnly prevents page JavaScript from reading the session; the extension
does not request cookies permission or scrape it. This manual setup is an
intentional limitation, not a claim that the service has a dedicated API-token
screen. User sessions currently expire after 30 days. Sign in and update Settings
when rejected. Sign out/revocation, expiry, suspension and deletion also apply to
this credential. Forget settings removes the local copy, **not** the server-side
session; use the account's sign-out-everywhere action to revoke sessions.

The token is password-equivalent account authority, stored in `storage.local`,
not browser sync; it is not encrypted against a compromised browser/profile.
Save grants optional host access only for the chosen service host; changing to a
different host removes the old grant after saving. WebExtension host permissions
cover all paths and ports on a selected scheme/host, but requests use only the
exact configured origin and fixed `/api/links` path. No credentials are sent to
the current page or the returned short URL. Redirects are refused (including
same-origin redirects), cookies are omitted, requests time out after 20 seconds,
and remote error bodies are never displayed. Permission denial leaves the
previous configuration unchanged. Browser/Safari website-access controls can
still deny access: grant it and save Settings again.

## Verification

```sh
# Pure core, lifecycle, local HTTP adapter, DOM and package checks
npm test --prefix extension
# Real Chromium extension action + real X11 clipboard MIME readback (Linux)
npx --prefix web playwright install --with-deps chromium
# Install xvfb, xauth, xdotool and xclip through your system package manager
xvfb-run -a npm run test:browser --prefix extension
# Native API authority, user ownership and revocation
cargo test --locked --test extension_auth
```

The browser fixture is an isolated loopback HTTP service with a held create
response; the Rust test separately exercises the actual native API and store.
The fixture does not claim a live production-account write. Browser screenshots
are written to `extension/artifacts/`. Chrome toolbar popups are not exposed as
ordinary Playwright pages in all Chromium versions; the harness attaches to the
actual popup via CDP after a real X11 action shortcut. It does not replace the
extension's active-tab or clipboard adapters with mocks.

Firefox and Safari packages share the same scripts, but packaging checks are not
runtime acceptance. Clipboard API support, host-access prompts, session setup and
rich pasting into Notes must be checked on those browsers before distribution.

## Architecture

`core.ts` contains only pure settings/page/short-address parsing and request
preparation; `view.ts` renders controlled popup states without fetching or
storage. `application.ts` owns initial extension observations and orchestrates one
create and one automatic plain copy through typed ports. `api.ts`, `platform.ts`,
`clipboard.ts`, `popup.ts` and `settings.ts`
are the thin HTTP/browser/DOM shells. The create DTO imports the existing generated
Rust contract rather than maintaining a competing wire type. No content script,
background worker, history access, remote script or broad required host access is
needed. The popup follows a compact, square Monospace Web grid with system light
and dark colors, reusing the application's self-hosted JetBrains Mono variable
fonts and their OFL license.
