import type { LinkInput } from "../../contracts/bindings/index.js";

export type Settings = Readonly<{ service: string; token: string }>;
export type Page = Readonly<{ title?: string; url?: string }>;
export type Ready = Readonly<{
  kind: "ready";
  title: string;
  url: string;
  copied: boolean;
}>;
export type Outcome = Ready | Readonly<{ kind: "error"; message: string }>;
export type Ports = Readonly<{
  create: (settings: Settings, input: LinkInput) => Promise<unknown>;
  copyText: (text: string) => Promise<unknown>;
}>;

export function serviceOrigin(value: string): string {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Use an HTTPS service origin without credentials, path, query or fragment (HTTP is loopback-only).",
    );
  }
  return url.origin;
}

export function parseSettings(settings: Settings): Settings {
  const service = serviceOrigin(settings.service);
  if (!settings.token || /[\s\x00-\x1f\x7f]/u.test(settings.token))
    throw new Error("Enter a valid user session token.");
  return { service, token: settings.token };
}

function pageAddress(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value || "");
  } catch {
    throw new Error("Open an HTTP or HTTPS page to shorten.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Open an HTTP or HTTPS page to shorten.");
  }
  return url.href;
}

export function shortAddress(response: unknown, service: string): string {
  if (
    !response ||
    typeof response !== "object" ||
    !("addresses" in response) ||
    !Array.isArray(response.addresses)
  ) {
    throw new Error(
      "The service returned an invalid short address. Check your account before trying again.",
    );
  }
  const primary: unknown = response.addresses.find(
    (a: unknown) =>
      a && typeof a === "object" && "domain_id" in a && a.domain_id === 1,
  );
  if (
    !primary ||
    typeof primary !== "object" ||
    !("domain" in primary) ||
    typeof primary.domain !== "string" ||
    !("short_code" in primary) ||
    typeof primary.short_code !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(primary.short_code)
  ) {
    throw new Error(
      "The service returned an invalid short address. Check your account before trying again.",
    );
  }
  const url = new URL(
    `${new URL(service).protocol}//${primary.domain}/${primary.short_code}`,
  );
  if (
    url.host !== primary.domain ||
    url.username ||
    url.password ||
    url.pathname !== `/${primary.short_code}` ||
    url.search ||
    url.hash
  ) {
    throw new Error("The service returned an unsafe short address.");
  }
  return url.href;
}

export function prepareCreation(
  settings: Settings,
  page: Page,
): Readonly<{ settings: Settings; title: string; input: LinkInput }> {
  const parsed = parseSettings(settings);
  const destination = pageAddress(page.url);
  const title = page.title || page.url || "";
  const input: LinkInput = {
    destination,
    title,
    alias: null,
    description: null,
    password: null,
    expires_at: null,
    click_limit: null,
    interstitial: false,
    query_mode: "discard",
    retention_days: null,
  };
  return { settings: parsed, title, input };
}

export function storedSettings(value: unknown): Settings | null {
  if (value == null) return null;
  if (
    typeof value !== "object" ||
    !("service" in value) ||
    typeof value.service !== "string" ||
    !("token" in value) ||
    typeof value.token !== "string"
  ) {
    throw new Error("Invalid stored settings. Update Settings.");
  }
  return parseSettings({ service: value.service, token: value.token });
}

export function permissionPattern(service: string): string {
  const url = new URL(service);
  return `${url.protocol}//${url.hostname}/*`;
}
