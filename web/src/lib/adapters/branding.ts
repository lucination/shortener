import * as publicEnvironment from "$env/static/public";
import { resolveAppName } from "../app-name";
/** Compiled into each static SPA. Runtime container env cannot change these bytes. */
export const appName = resolveAppName(
  (publicEnvironment as Record<string, string | undefined>)["PUBLIC_APP_NAME"],
);
