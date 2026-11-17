import {
  parseSettings,
  storedService,
  permissionPattern,
  type Settings,
} from "./core.js";
import type { ExtensionApi } from "./platform.js";
export async function saveSettings(
  api: ExtensionApi,
  settings: Settings,
): Promise<void> {
  settings = parseSettings(settings);
  const pattern = permissionPattern(settings.service);
  if (!(await api.permissions.request({ origins: [pattern] })))
    throw new Error("Service access denied. Settings were not saved.");
  const previous = (await api.storage.local.get("settings")).settings;
  const old = storedService(previous);
  if (old && permissionPattern(old) !== pattern)
    await removeServicePermission(api, old);
  await api.storage.local.set({ settings });
}

async function removeServicePermission(
  api: ExtensionApi,
  service: string,
): Promise<void> {
  try {
    if (await api.permissions.remove({ origins: [permissionPattern(service)] }))
      return;
  } catch {
    /* Retain the saved origin so cleanup can be retried. */
  }
  throw new Error(
    `Could not remove service permission for ${service}. Saved settings were retained; retry or remove the permission in browser extension settings. Any newly requested service permission may still be granted.`,
  );
}

export async function forgetSettings(api: ExtensionApi): Promise<void> {
  const previous = storedService(
    (await api.storage.local.get("settings")).settings,
  );
  if (previous) await removeServicePermission(api, previous);
  await api.storage.local.remove("settings");
}
