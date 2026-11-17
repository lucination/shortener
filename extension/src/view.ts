import type { Ready } from "./core.js";
export type PopupState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "setup" }
  | Ready;
export type Actions = { copyText: () => void; copyRich: () => void };
export function render(
  root: HTMLElement,
  state: PopupState,
  actions: Actions,
): void {
  const doc = root.ownerDocument;
  const paragraph = (text: string, className = "") => {
    const p = doc.createElement("p");
    p.textContent = text;
    p.className = className;
    return p;
  };
  root.replaceChildren();
  switch (state.kind) {
    case "loading":
      root.append(paragraph("Shortening…"));
      return;
    case "setup":
      root.append(
        paragraph(
          "Set your service URL and access token in Settings. Create a token in Account → Access tokens.",
        ),
      );
      return;
    case "error":
      root.append(paragraph(state.message, "error"));
      return;
    case "ready": {
      const title = doc.createElement("a");
      title.href = state.url;
      title.textContent = state.title;
      title.className = "title";
      title.addEventListener("click", (event) => {
        event.preventDefault();
        actions.copyRich();
      });
      const copy = doc.createElement("button");
      copy.type = "button";
      copy.textContent = "Copy URL";
      copy.addEventListener("click", actions.copyText);
      root.append(
        title,
        paragraph(state.url, "address"),
        copy,
        paragraph(
          state.copied
            ? "URL copied. Click the title to copy a formatted link."
            : "Link created. Automatic URL copy did not complete. Click Copy URL to retry, or click the title for a formatted link.",
        ),
      );
    }
  }
}
