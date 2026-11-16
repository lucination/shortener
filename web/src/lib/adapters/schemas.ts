import { parsePasskeyName } from "../passkey-name";
import { z } from "zod";
import type * as DTO from "../generated";
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();
const destination = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:";
}, "Only HTTP(S) destinations");
export const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
}) satisfies z.ZodType<DTO.ErrorBody>;
export const messageSchema = z.object({
  message: z.string(),
}) satisfies z.ZodType<DTO.Message>;
const addressSchema = z.object({
  id,
  domain_id: id,
  domain: z.string().min(1),
  short_code: z.string().min(1),
}) satisfies z.ZodType<DTO.Address>;
export const userSchema = z.object({
  id,
  email: z.email(),
  verified_at: instant.nullable(),
  suspended: z.boolean(),
  deleted_at: instant.nullable(),
  retention_days: id.nullable(),
  link_quota: count.nullable(),
  created_at: instant,
}) satisfies z.ZodType<DTO.User>;
export const linkSchema = z.object({
  id,
  owner_id: id,
  destination,
  title: z.string().nullable(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  deleted_at: instant.nullable(),
  expires_at: instant.nullable(),
  click_limit: id.nullable(),
  human_clicks: count,
  password_protected: z.boolean(),
  interstitial: z.boolean(),
  query_mode: z.enum(["discard", "preserve", "override"]),
  retention_days: id.nullable(),
  created_at: instant,
  addresses: z.array(addressSchema),
}) satisfies z.ZodType<DTO.Link>;
export const linkListSchema = z
  .object({ items: z.array(linkSchema), total: count })
  .refine(
    (value) => value.total >= value.items.length,
  ) satisfies z.ZodType<DTO.LinkList>;
export const userListSchema = z
  .object({ items: z.array(userSchema), total: count })
  .refine(
    (value) => value.total >= value.items.length,
  ) satisfies z.ZodType<DTO.UserList>;
const eventSchema = z.object({
  id,
  link_id: id,
  address_id: id,
  occurred_at: instant,
  kind: z.enum(["human", "bot", "link_preview", "preview"]),
  ip: z.string(),
  user_agent: z.string(),
  referrer: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  browser: z.string(),
  os: z.string(),
  device: z.string(),
}) satisfies z.ZodType<DTO.ClickEvent>;
export const eventListSchema = z
  .object({ items: z.array(eventSchema), total: count })
  .refine(
    (value) => value.total >= value.items.length,
  ) satisfies z.ZodType<DTO.EventList>;
const breakdown = z.object({ label: z.string(), count });
export const statsSchema = z.object({
  link_id: id,
  from: date,
  to: date,
  redirects: count,
  humans: count,
  bots: count,
  previews: count,
  daily: z.array(
    z.object({
      date,
      redirects: count,
      humans: count,
      bots: count,
      previews: count,
      daily_unique: count,
    }),
  ),
  referrers: z.array(breakdown),
  countries: z.array(breakdown),
  devices: z.array(breakdown),
}) satisfies z.ZodType<DTO.LinkStats>;
export const usageSchema = z.object({
  users: count,
  links: count,
  redirects: count,
  raw_events: count,
}) satisfies z.ZodType<DTO.Usage>;
export const bulkSchema = z.object({
  items: z.array(
    z.discriminatedUnion("status", [
      z.object({
        status: z.literal("created"),
        index: count,
        link: linkSchema,
      }),
      z.object({
        status: z.literal("failed"),
        index: count,
        error: errorSchema,
      }),
    ]),
  ),
}) satisfies z.ZodType<DTO.BulkResponse>;
export const bulkUpdateSchema = z.object({
  updated: z.array(id),
  items: z.array(
    z.discriminatedUnion("status", [
      z.object({ status: z.literal("updated"), index: count, id }),
      z.object({
        status: z.literal("failed"),
        index: count,
        id,
        error: errorSchema,
      }),
    ]),
  ),
}) satisfies z.ZodType<DTO.BulkUpdateResponse>;
export const passkeyOptionsSchema = z.object({
  challenge_id: z.string().min(1),
  public_key: z.json(),
}) satisfies z.ZodType<DTO.PasskeyOptions>;
export const passkeySummarySchema = z.object({
  id,
  name: z.string().refine((value) => parsePasskeyName(value) !== undefined),
}) satisfies z.ZodType<DTO.PasskeySummary>;
export const passkeyListSchema = z.object({
  items: z.array(passkeySummarySchema),
}) satisfies z.ZodType<DTO.PasskeyList>;
