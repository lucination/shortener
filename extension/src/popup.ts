import { extensionApi } from "./platform.js";
import { startPopup } from "./application.js";
import { createLink } from "./api.js";
import { copyRich } from "./clipboard.js";
import { render, type PopupState } from "./view.js";
const api = extensionApi();
const root = document.querySelector<HTMLElement>("#app")!;
const feedback = document.createElement("p");
feedback.id = "feedback";
document.body.append(feedback);
let state: PopupState = { kind: "loading" };
let attempt = 0;
const copy = async (rich: boolean) => {
  if (state.kind !== "ready") return;
  const current = ++attempt;
  feedback.textContent = "Copying…";
  try {
    if (rich) await copyRich(state.title, state.url);
    else await navigator.clipboard.writeText(state.url);
    if (current === attempt)
      feedback.textContent = rich ? "Formatted link copied." : "URL copied.";
  } catch {
    if (current === attempt)
      feedback.textContent = rich
        ? "Formatted copy failed. Try again, or use Copy URL."
        : "Copy failed. Click Copy URL to retry.";
  }
};
document.querySelector("#settings")!.addEventListener("click", () => {
  void api.runtime.openOptionsPage().catch(() => {
    feedback.textContent =
      "Open extension options from your browser’s extension settings.";
  });
});
void startPopup(
  api,
  {
    create: createLink,
    copyText: (text) => navigator.clipboard.writeText(text),
  },
  (next) => {
    state = next;
    render(root, state, {
      copyText: () => {
        void copy(false);
      },
      copyRich: () => {
        void copy(true);
      },
    });
  },
);
