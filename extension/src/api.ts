import type { LinkInput } from "../../contracts/bindings/index.js";
import { parseSettings, type Settings } from "./core.js";

export async function createLink(
  settings: Settings,
  input: LinkInput,
): Promise<unknown> {
  settings = parseSettings(settings);
  let response: Response;
  try {
    response = await fetch(`${settings.service}/api/links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.token}`,
      },
      body: JSON.stringify(input),
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(
      "Request did not complete. Check your account for a created link before trying again. Redirects are not followed.",
    );
  }
  if (response.status === 401 || response.status === 403)
    throw new Error(
      "Access token not accepted. Create a replacement in Account → Access tokens and update Settings.",
    );
  if (response.status !== 201)
    throw new Error(
      `Service returned HTTP ${response.status}. Check your account before trying again.`,
    );
  try {
    return await response.json();
  } catch {
    throw new Error(
      "Invalid service response. Check your account before trying again.",
    );
  }
}
