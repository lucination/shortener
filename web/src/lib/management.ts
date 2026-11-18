import type { StatisticsTab } from "./view-models";
export type ManagementPath = Readonly<{
  code: string;
  kind: "statistics" | "edit";
}>;
const reserved = new Set([
  "api",
  "auth",
  "v",
  "_",
  "_app",
  "admin",
  "assets",
  "fonts",
  "favicon",
  "robots",
  "index",
  "login",
  "account",
  "links",
]);
const safeCode = (code: string) =>
  /^[A-Za-z0-9_-]{1,64}$/.test(code) && !reserved.has(code.toLowerCase());
export function managementPath(path: string): ManagementPath | null {
  const match = /^\/([^/]+)\/(statistics|edit)$/.exec(path);
  if (!match || !safeCode(match[1])) return null;
  return { code: match[1], kind: match[2] as ManagementPath["kind"] };
}
export function managementUrl(
  code: string,
  kind: ManagementPath["kind"],
): string | null {
  return safeCode(code) ? `/${code}/${kind}` : null;
}
/** Client-only view selector: a fragment never reaches the native authorizer. */
export const statisticsTab = (hash: string): StatisticsTab =>
  hash === "#events" ? "events" : "overview";
export const statisticsHash = (tab: StatisticsTab): string =>
  tab === "events" ? "#events" : "";
