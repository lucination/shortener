import type { ExtensionApi } from "./platform.js";
import {
  storedSettings,
  prepareCreation,
  shortAddress,
  permissionPattern,
  type Settings,
  type Page,
  type Outcome,
  type Ports,
} from "./core.js";
import type { PopupState } from "./view.js";
export async function shorten(
  settings: Settings,
  page: Page,
  ports: Ports,
): Promise<Outcome> {
  try {
    const prepared = prepareCreation(settings, page);
    const url = shortAddress(
      await ports.create(prepared.settings, prepared.input),
      prepared.settings.service,
    );
    let copied = false;
    try {
      await ports.copyText(url);
      copied = true;
    } catch {
      /* Keep the created address for retry. */
    }
    return { kind: "ready", title: prepared.title, url, copied };
  } catch (error) {
    return {
      kind: "error",
      message:
        error instanceof Error ? error.message : "Unable to shorten this page.",
    };
  }
}

export async function startPopup(
  api: ExtensionApi,
  ports: Ports,
  publish: (state: PopupState) => void,
): Promise<void> {
  publish({ kind: "loading" });
  try {
    const [pages, saved] = await Promise.all([
      api.tabs.query({ active: true, currentWindow: true }),
      api.storage.local.get("settings"),
    ]);
    const settings = storedSettings(saved.settings);
    if (!settings) {
      publish({ kind: "setup" });
      return;
    }
    if (
      !(await api.permissions.contains({
        origins: [permissionPattern(settings.service)],
      }))
    ) {
      publish({
        kind: "error",
        message:
          "Service access is not granted. Save Settings to grant access.",
      });
      return;
    }
    publish(await shorten(settings, pages[0] ?? {}, ports));
  } catch {
    publish({
      kind: "error",
      message:
        "Cannot read the active page or settings. Reopen the popup or update Settings.",
    });
  }
}
