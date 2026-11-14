import type * as DTO from "./generated";
import type {
  LinkRow,
  StatsView,
  EventRow,
  UserRow,
  LinkDraft,
} from "./view-models";
export const linkRow = (link: DTO.Link): LinkRow => ({
  id: link.id,
  label: link.title || `Link #${link.id}`,
  destination: link.destination,
  address: link.addresses[0]
    ? `${link.addresses[0].domain}/${link.addresses[0].short_code}`
    : "No address",
  clicks: link.human_clicks,
  enabled: link.enabled,
});
export const statsView = (stats: DTO.LinkStats): StatsView => ({
  human: stats.humans,
  bot: stats.bots,
  preview: stats.previews,
  days: stats.daily.map((day) => ({ day: day.date, human: day.humans })),
  countries: stats.countries,
  devices: stats.devices,
  referrers: stats.referrers,
});
export const eventRow = (event: DTO.ClickEvent): EventRow => ({
  id: event.id,
  at: event.occurred_at,
  link: `#${event.link_id}`,
  ip: event.ip,
  ua: event.user_agent,
  referrer: event.referrer || "Direct / unknown",
  country: event.country || "Unknown",
  city: event.city || "Unknown",
  browser: event.browser,
  os: event.os,
  device: event.device,
  classification:
    event.kind === "human" ? "human" : event.kind === "bot" ? "bot" : "preview",
});
export const userRow = (user: DTO.User): UserRow => ({
  id: user.id,
  email: user.email,
  status: user.deleted_at ? "deleted" : user.suspended ? "suspended" : "active",
  quota: user.link_quota === null ? "Unlimited" : String(user.link_quota),
  retention:
    user.retention_days === null ? "Default" : String(user.retention_days),
});
export const linkDraft = (link: DTO.Link): LinkDraft => ({
  destination: link.destination,
  alias: link.addresses[0]?.short_code ?? "",
  title: link.title ?? "",
  description: link.description ?? "",
  password: "",
  expiresAt: link.expires_at
    ? new Date(
        Date.parse(link.expires_at) -
          new Date(link.expires_at).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "",
  clickLimit: link.click_limit === null ? "" : String(link.click_limit),
  retentionDays:
    link.retention_days === null ? "" : String(link.retention_days),
  interstitial: link.interstitial,
  queryMode: link.query_mode,
});
