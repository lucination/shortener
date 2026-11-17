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
    text: `${title} (${url})`,
  };
}

export async function copyRich(title: string, url: string): Promise<void> {
  const payload = hyperlink(title, url);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([payload.html], { type: "text/html" }),
          "text/plain": new Blob([payload.text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      /* Firefox/older Safari may require the synchronous copy-event path. */
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
