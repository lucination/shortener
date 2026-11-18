/** Presentation models are not wire DTOs. Backend DTO -> view mappings live in adapters. */
export type Resource<T> =
  | { kind: "pending" }
  | {
      kind: "error";
      message: string;
      reason?: "validation" | "authentication" | "network" | "server";
    }
  | { kind: "ready"; value: T };
export type EnrollmentState =
  | { kind: "idle" }
  | { kind: "enrolling" }
  | { kind: "succeeded"; message: string }
  | { kind: "failed"; message: string };
export type Outcome =
  | { kind: "idle" }
  | { kind: "pending" }
  | {
      kind: "error";
      message: string;
      reason?: "validation" | "authentication" | "network" | "server";
    }
  | { kind: "success"; message: string };
export type LinkRow = Readonly<{
  id: number;
  label: string;
  destination: string;
  address: string;
  clicks: number;
  enabled: boolean;
}>;
export type LinkAction =
  "copy" | "edit" | "stats" | "events" | "toggle" | "delete";
export type BulkAction =
  "enable" | "disable" | "delete" | "expiration" | "retention";
export const bulkActionLabels: Readonly<Record<BulkAction, string>> = {
  enable: "Enable",
  disable: "Disable",
  delete: "Delete",
  expiration: "Set expiration",
  retention: "Set retention",
};
export const filterLinks = (
  rows: readonly LinkRow[],
  query: string,
): readonly LinkRow[] =>
  rows.filter((row) =>
    [row.label, row.destination, row.address].some((value) =>
      value.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
export const toggleSelection = (
  ids: readonly number[],
  id: number,
): readonly number[] =>
  ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
export type EditorMode = { kind: "create" } | { kind: "edit"; id: number };
export type LinkDraft = Readonly<{
  destination: string;
  alias: string;
  title: string;
  description: string;
  password: string;
  expiresAt: string;
  clickLimit: string;
  retentionDays: string;
  interstitial: boolean;
  queryMode: "discard" | "preserve" | "override";
}>;
export const emptyDraft: LinkDraft = {
  destination: "",
  alias: "",
  title: "",
  description: "",
  password: "",
  expiresAt: "",
  clickLimit: "",
  retentionDays: "",
  interstitial: false,
  queryMode: "discard",
};
export type DateRange = Readonly<{ from: string; to: string }>;
export type CountGroup = Readonly<{ label: string; count: number }>;
export type StatsView = Readonly<{
  /** Period of the observed response, independent of unsaved date controls. */
  range?: DateRange;
  human: number;
  bot: number;
  preview: number;
  days: readonly { day: string; human: number }[];
  countries: readonly CountGroup[];
  devices: readonly CountGroup[];
  referrers: readonly CountGroup[];
}>;
export type EventRow = Readonly<{
  id: number;
  at: string;
  link: string;
  ip: string;
  ua: string;
  referrer: string;
  country: string;
  city: string;
  browser: string;
  os: string;
  device: string;
  classification: "human" | "bot" | "preview";
}>;
export type EventsView = Readonly<{
  /** Period of the observed request, independent of unsaved date controls. */
  range: DateRange;
  rows: readonly EventRow[];
}>;
/** The two views of one link's traffic on its native statistics page. */
export type StatisticsTab = "overview" | "events";
/**
 * One link's statistics page: a single applied observation shown as either
 * the overview or its retained events. Each view's resource belongs to the
 * same applied date range.
 */
export type AnalyticsView = Readonly<{
  label: string;
  tab: StatisticsTab;
  stats: Resource<StatsView>;
  events: Resource<EventsView>;
}>;
export type UserRow = Readonly<{
  id: number;
  email: string;
  status: "active" | "suspended" | "deleted";
  quota: string;
  retention: string;
}>;
export type UserAction =
  "suspend" | "reactivate" | "delete" | "quota" | "retention" | "signout";
export type AdminView =
  | { kind: "users"; state: Resource<readonly UserRow[]> }
  | { kind: "links"; state: Resource<readonly LinkRow[]> }
  | { kind: "events"; state: Resource<readonly EventRow[]> }
  | { kind: "usage"; state: Resource<readonly CountGroup[]> };
export type AuthMode =
  { kind: "magic"; email: string } | { kind: "admin"; token: string };
export type PublicView =
  | { kind: "password"; password: string }
  | { kind: "preview"; title: string; description: string; destination: string }
  | { kind: "not-found" };

/** One transient quick-action notice (copy, toggle, delete, bulk, save). */
export type Notice =
  { kind: "idle" } | { kind: "success" | "error"; message: string };
