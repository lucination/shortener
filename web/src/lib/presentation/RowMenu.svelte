<script module lang="ts">
  import type { Component } from "svelte";
  export type RowMenuItem = Readonly<{
    id: string;
    label: string;
    icon?: Component<{ size?: number }>;
    tone?: "danger";
    /** Draw a separator before this item. */
    separated?: boolean;
  }>;
  // Only one row menu is open at a time across the page.
  let closeActive: (() => void) | null = null;
  let sequence = 0;
</script>

<script lang="ts">
  import { tick } from "svelte";
  import { Ellipsis } from "@lucide/svelte";
  let {
    label,
    items,
    onselect,
  }: {
    /** Accessible name of the trigger, e.g. "More actions for Field notes". */
    label: string;
    items: readonly RowMenuItem[];
    onselect: (id: string) => void;
  } = $props();
  const menuId = `row-menu-${++sequence}`;
  // Ephemeral disclosure state only; the menu owns no application data.
  let open = $state(false);
  let position = $state({ top: 0, left: 0 });
  let root: HTMLElement;
  let trigger: HTMLButtonElement;
  let menu: HTMLElement | undefined = $state();
  const entries = (): HTMLButtonElement[] =>
    menu ? Array.from(menu.querySelectorAll('[role="menuitem"]')) : [];
  const close = (restoreFocus = false) => {
    if (!open) return;
    // Never strand keyboard focus on a removed menu item.
    const focusInside = !!menu?.contains(document.activeElement);
    open = false;
    if (closeActive === dismiss) closeActive = null;
    if (restoreFocus || focusInside) trigger.focus({ preventScroll: true });
  };
  const dismiss = () => close(false);
  const place = () => {
    const rect = trigger.getBoundingClientRect();
    const height = menu?.offsetHeight ?? 0;
    const width = menu?.offsetWidth ?? 0;
    const below = rect.bottom + 4;
    const top =
      below + height > window.innerHeight && rect.top - 4 - height >= 0
        ? rect.top - 4 - height
        : below;
    const left = Math.max(
      4,
      Math.min(rect.right - width, window.innerWidth - width - 4),
    );
    position = { top, left };
  };
  // Follow the trigger while the page or table scrolls; a scroll that lands
  // just after opening (scroll-into-view, momentum) must not dismiss it.
  const follow = () => {
    if (!open) return;
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) close(false);
    else place();
  };
  const show = async (focus: "first" | "last") => {
    if (closeActive && closeActive !== dismiss) closeActive();
    closeActive = dismiss;
    open = true;
    await tick();
    place();
    const list = entries();
    (focus === "first" ? list[0] : list[list.length - 1])?.focus({
      preventScroll: true,
    });
  };
  const move = (step: number) => {
    const list = entries();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(index + step + list.length) % list.length]?.focus({
      preventScroll: true,
    });
  };
  const onTriggerKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      void show(event.key === "ArrowDown" ? "first" : "last");
    }
  };
  const onMenuKey = (event: KeyboardEvent) => {
    const list = entries();
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Home") list[0]?.focus();
    else if (event.key === "End") list[list.length - 1]?.focus();
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") {
      // Let the browser continue tabbing from the trigger.
      close(true);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const choose = (id: string) => {
    close(true);
    onselect(id);
  };
</script>

<svelte:window
  onpointerdown={(event) => {
    if (open && !root.contains(event.target as Node)) close(false);
  }}
  onscrollcapture={(event) => {
    const target = event.target;
    if (!(menu && target instanceof Node && menu.contains(target))) follow();
  }}
  onresize={follow}
/>
<div
  class="row-menu"
  bind:this={root}
  onfocusout={(event) => {
    const next = event.relatedTarget as Node | null;
    // A null target is an outside click or window blur; pointer handling covers clicks.
    if (open && next && !root.contains(next)) close(false);
  }}
>
  <button
    type="button"
    class="icon-button"
    bind:this={trigger}
    aria-label={label}
    title="More actions"
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls={open ? menuId : undefined}
    onclick={() => (open ? close(false) : void show("first"))}
    onkeydown={onTriggerKey}><Ellipsis size={16} /></button
  >
  {#if open}<div
      class="row-menu-list"
      id={menuId}
      role="menu"
      tabindex="-1"
      aria-label={label}
      bind:this={menu}
      style:top={`${position.top}px`}
      style:left={`${position.left}px`}
      onkeydown={onMenuKey}
    >
      {#each items as item (item.id)}{#if item.separated}<div
            role="separator"
            class="row-menu-separator"
          ></div>{/if}<button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="row-menu-item"
          class:danger={item.tone === "danger"}
          data-action={item.id}
          onclick={() => choose(item.id)}
          >{#if item.icon}<item.icon size={14} />{/if}{item.label}</button
        >{/each}
    </div>{/if}
</div>
