import { extensionApi } from "./platform.js";
import { storedSettings, storedService } from "./core.js";
import { saveSettings, forgetSettings } from "./configuration.js";
const api = extensionApi();
const form = document.querySelector<HTMLFormElement>("#settings-form")!;
const service = document.querySelector<HTMLInputElement>("#service")!;
const token = document.querySelector<HTMLInputElement>("#token")!;
const status = document.querySelector<HTMLElement>("#status")!;
const save = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const forget = document.querySelector<HTMLButtonElement>("#forget")!;
const busy = (value: boolean) => {
  save.disabled = value;
  forget.disabled = value;
};
busy(true);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  busy(true);
  status.textContent = "Saving…";
  // Request host access in this user gesture, before awaiting storage.
  void saveSettings(api, { service: service.value, token: token.value })
    .then(() => {
      status.textContent =
        "Saved. Open the toolbar popup on the page you want to shorten.";
      token.value = "";
    })
    .catch((error: unknown) => {
      status.textContent =
        error instanceof Error ? error.message : "Settings could not be saved.";
    })
    .finally(() => busy(false));
});
forget.addEventListener("click", () => {
  busy(true);
  void (async () => {
    await forgetSettings(api);
    service.value = "";
    token.value = "";
    status.textContent =
      "Settings forgotten. This does not revoke the access token on the service. Revoke it in Account → Access tokens.";
  })()
    .catch((error: unknown) => {
      status.textContent =
        error instanceof Error
          ? error.message
          : "Could not finish forgetting settings. Check browser extension permissions.";
    })
    .finally(() => busy(false));
});
void api.storage.local
  .get("settings")
  .then((saved) => {
    const origin = storedService(saved.settings);
    if (origin) service.value = origin;
    try {
      const settings = storedSettings(saved.settings);
      if (settings) token.value = settings.token;
    } catch {
      token.value = "";
      status.textContent =
        "Saved credential is no longer supported. Create a token in Account → Access tokens, then save it here, or Forget settings.";
    }
  })
  .catch(() => {
    status.textContent = "Cannot read saved settings. Enter them again.";
  })
  .finally(() => busy(false));
