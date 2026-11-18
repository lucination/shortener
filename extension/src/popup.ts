import { extensionApi } from "./platform.js";
import { startPopup } from "./application.js";
import { createLink } from "./api.js";
import { copyRich, markdownLink } from "./clipboard.js";
import { render, type PopupState } from "./view.js";
const api = extensionApi();
const root = document.querySelector<HTMLElement>("#app")!;
const feedback = document.createElement("p");
feedback.id = "feedback";
document.body.append(feedback);
let state: PopupState = { kind: "loading" };
let copying = false;
const copy = async (kind: "url" | "rich" | "markdown") => {
  if (state.kind !== "ready" || copying) return;
  copying = true;
  const buttons = root.querySelectorAll<HTMLButtonElement>("button");
  buttons.forEach((button) => (button.disabled = true));
  feedback.className = "";
  feedback.textContent = "Copying…";
  try {
    if (kind === "rich") await copyRich(state.title, state.url);
    else
      await navigator.clipboard.writeText(
        kind === "markdown" ? markdownLink(state.title, state.url) : state.url,
      );
    feedback.textContent =
      kind === "rich"
        ? "Formatted link copied."
        : kind === "markdown"
          ? "Markdown copied."
          : "URL copied.";
  } catch {
    feedback.className = "error";
    feedback.textContent =
      kind === "rich"
        ? "Formatted copy failed. Try again, or use Copy URL."
        : kind === "markdown"
          ? "Markdown copy failed. Click Copy Markdown to retry."
          : "Copy failed. Click Copy URL to retry.";
  } finally {
    copying = false;
    buttons.forEach((button) => (button.disabled = false));
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
        void copy("url");
      },
      copyMarkdown: () => {
        void copy("markdown");
      },
      copyRich: () => {
        void copy("rich");
      },
    });
  },
);
