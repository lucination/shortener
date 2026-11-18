import type { Ready } from "./core.js";
export type PopupState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "setup" }
  | Ready;
export type Actions = {
  copyText: () => void;
  copyRich: () => void;
  copyMarkdown: () => void;
};
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
      // Lucide Copy icon, @lucide/svelte 1.73.0 (ISC; bundled notice).
      const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [key, value] of Object.entries({
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
      }))
        icon.setAttribute(key, value);
      const nodes = [
        [
          "rect",
          { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" },
        ],
        [
          "path",
          { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" },
        ],
      ] as const;
      for (const [tag, attributes] of nodes) {
        const node = doc.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [key, value] of Object.entries(attributes))
          node.setAttribute(key, value);
        icon.append(node);
      }
      copy.append(icon, doc.createTextNode("Copy URL"));
      copy.addEventListener("click", actions.copyText);
      const markdown = copy.cloneNode(true) as HTMLButtonElement;
      markdown.lastChild!.textContent = "Copy Markdown";
      markdown.dataset.copy = "markdown";
      markdown.addEventListener("click", actions.copyMarkdown);
      const controls = doc.createElement("div");
      controls.className = "actions";
      controls.append(copy, markdown);
      root.append(
        title,
        paragraph(state.url, "address"),
        controls,
        paragraph(
          state.copied
            ? "URL copied. Click the title to copy a formatted link."
            : "Link created. Automatic URL copy did not complete. Click Copy URL to retry, or click the title for a formatted link.",
        ),
      );
    }
  }
}
