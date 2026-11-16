/** Floating feedback follows its own row button, outside table layout and clipping. */
export function anchorFeedback(node: HTMLElement, _layout: unknown) {
  const anchor = node.parentElement!.querySelector("button")!;
  const position = () => {
    const rect = anchor.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.max(
      8,
      Math.min(rect.right - width, window.innerWidth - width - 8),
    );
    const top =
      rect.bottom + height + 6 <= window.innerHeight - 8
        ? rect.bottom + 6
        : Math.max(8, rect.top - height - 6);
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.visibility =
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
        ? "visible"
        : "hidden";
  };
  position();
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  return {
    update: position,
    destroy() {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    },
  };
}
