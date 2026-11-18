function escape(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

export function hyperlink(
  title: string,
  url: string,
): Readonly<{ html: string; text: string }> {
  return {
    html: `<a href="${escape(url)}">${escape(title)}</a>`,
    text: url,
  };
}

/** Plain Markdown action and optional *native* Markdown representation.
 * Never use the custom `web text/markdown` format as a substitute. */
export function markdownLink(title: string, url: string): string {
  if (
    !/^https?:\/\//iu.test(url) ||
    /[\u0000-\u0020\u007f\u2028\u2029]/u.test(url)
  )
    throw new Error("Markdown copy requires a safe HTTP or HTTPS address.");
  new URL(url); // Reject malformed destinations, without silently normalizing their bytes.
  const label = title
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/gu, " ")
    .replace(/[\\[\]`*_{}<>!|]/gu, "\\$&")
    .replace(/&/gu, "&amp;");
  const destination = url
    .replace(/[()\\<>`{}"]/gu, (c) =>
      [...new TextEncoder().encode(c)]
        .map((byte) => "%" + byte.toString(16).toUpperCase().padStart(2, "0"))
        .join(""),
    )
    .replace(/&/gu, "&amp;");
  return `[${label}](${destination})`;
}

function nativeMarkdownSupported(): boolean {
  try {
    return (
      typeof ClipboardItem.supports === "function" &&
      ClipboardItem.supports("text/markdown") === true
    );
  } catch {
    return false;
  }
}

export async function copyRich(title: string, url: string): Promise<void> {
  const payload = hyperlink(title, url);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const data = {
      "text/html": new Blob([payload.html], { type: "text/html" }),
      "text/plain": new Blob([payload.text], { type: "text/plain" }),
    };
    if (nativeMarkdownSupported()) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            ...data,
            "text/markdown": new Blob([markdownLink(title, url)], {
              type: "text/markdown",
            }),
          }),
        ]);
        return;
      } catch {
        /* A lying capability or rejected third MIME must not lose HTML. */
      }
    }
    try {
      await navigator.clipboard.write([new ClipboardItem(data)]);
      return;
    } catch {
      /* Preserve the existing synchronous HTML + URL copy-event path. */
    }
  }

  let supplied = false;
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/html", payload.html);
    event.clipboardData.setData("text/plain", payload.text);
    event.preventDefault();
    supplied = true;
  };
  document.addEventListener("copy", onCopy);
  try {
    if (!document.execCommand("copy") || !supplied)
      throw new Error(
        "Formatted copy is unavailable. Use Copy URL or try again.",
      );
  } finally {
    document.removeEventListener("copy", onCopy);
  }
}
