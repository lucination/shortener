# Shortener Companion privacy policy

Last updated: 2026-11-18

## Scope and your choice of service

This policy describes the Shortener Companion browser extension for Safari, Firefox and Chromium-based browsers. The extension connects to the Shortener instance you choose in Settings. That instance may be operated by you or by someone else. This policy is not a substitute for that operator's privacy policy, and does not promise that a self-hosted service collects no data. Only configure an instance you trust.

## When the extension uses page information

Opening the toolbar popup, including through its keyboard shortcut, starts shortening the active HTTP or HTTPS page when valid settings and service permission are available. There is no separate confirmation before sending. The extension reads the active page's URL and title and sends them to the configured service's POST /api/links endpoint to create a short link in your account. If no title is available, the URL is used as the title. URLs can contain sensitive query parameters or fragments; check the page before invoking the extension.

The extension does not read the page body, form contents or browsing history. It has no content script or background worker monitoring navigation. Opening the popup again can create another link. Closing the popup, a timeout or a failed response does not guarantee that the server did not create a link; check your account before retrying.

## Settings, authentication and permissions

The configured service origin and access token are saved in the browser extension's storage.local, not browser sync. The token authorizes link creation on your selected service. The extension sends it only to that exact configured origin at /api/links, not to the current page or the returned short address. It omits session cookies and refuses request redirects.

Saving settings requests optional website access for the chosen service host. Browser host permissions can cover all paths and ports on that scheme and host, but the extension's requests use the exact saved origin and fixed endpoint. Changing the host removes the previous host permission as part of saving. HTTPS is required except for local loopback development services. Local token storage is not protection against a compromised browser or profile; keep the token private.

## Clipboard use

After creating a link, the popup tries to write only the short URL to the clipboard. Copy URL retries that write without creating another link. Clicking the displayed title copies a title hyperlink as HTML and the short URL as plain text; where explicitly supported, it also attempts a native Markdown representation. Copy Markdown writes Markdown link syntax as plain text. Format availability depends on the browser and operating system.

The extension writes these values but does not read your existing clipboard. The copied text may be available to applications you paste into and to operating-system clipboard history or synchronization features under their own settings and policies. Copying does not itself send another request to the shortener service.

## Extension tracking and recipients

The extension has no developer telemetry, advertising SDKs, third-party analytics or remote scripts. It does not send extension activity, page URLs, titles or tokens to a separate developer-operated collection endpoint. Its link-creation request goes to the instance you configured. If the developer also operates that instance, the developer receives data in that operator role, not through a separate extension telemetry channel.

## Data held by a Shortener instance

The selected instance receives the submitted destination URL, title and authentication token, and can associate the created link with your account. Network requests also expose connection information such as your IP address to the service and its hosting infrastructure. The server validates access tokens; this project's server stores token hashes rather than the issued secret.

The Shortener server is a separate data-processing system. Its account and authentication features store account information such as email addresses, passkey credentials and session records. Its link features store destinations, titles and link settings. When short links are visited, its analytics can record timestamps, IP addresses, user-agent strings, referrers, browser/OS/device categories and approximate IP-derived geolocation such as country or city, where configured. Analytics are not the same as extension telemetry.

The instance operator determines hosting, access, retention settings, backups and any additional processing or disclosures. Reverse proxies, hosting providers and other infrastructure may maintain separate infrastructure logs. Ask the configured instance operator for its applicable privacy policy, retention periods, recipients and handling of account, link and visit data. No fixed server or backup retention period is promised by this extension policy.

## Removal and your controls

Use Settings → Forget settings to remove the extension's saved origin and token and its service host permission. If permission removal fails, settings are retained so cleanup can be retried; follow the displayed error or remove permissions in browser extension settings. You can also remove the extension and use your browser's controls to clear its local data. The extension does not maintain a persistent local history of shortened pages; the current result is displayed in the popup. Clipboard contents are managed separately by your browser and operating system.

Forgetting settings or uninstalling does not revoke the server token or delete links, account data, analytics, logs or backups. Revoke the token separately in the instance's Account → Access tokens controls; signing out does not revoke independent access tokens. Manage or delete links through the instance, and contact its operator about account deletion, access, correction, export, retention or other private data requests. Server-side deletion and backup handling depend on that instance's policy and controls.

## Contact and changes

For extension bugs or questions about this policy, use the public project issue tracker: https://github.com/lucination/shortener/issues

Do not post tokens, private URLs, account details or other sensitive information in public issues. Send private account-data requests to your configured instance operator through its own support channel, not the public project tracker.

Updates to this policy will be published here with a revised last-updated date.
