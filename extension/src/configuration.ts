import {
  parseSettings,
  storedSettings,
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
  await api.storage.local.set({ settings });
  let old: Settings | null = null;
  try {
    old = storedSettings(previous);
  } catch {
    /* Corrupt previous settings carry no trusted origin. */
  }
  if (old && permissionPattern(old.service) !== pattern)
    await api.permissions.remove({ origins: [permissionPattern(old.service)] });
}
