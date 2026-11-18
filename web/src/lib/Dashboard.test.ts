import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/svelte";
import { tick } from "svelte";
import Dashboard from "./Dashboard.svelte";
import { simulatedLinkRows } from "./fixtures";

const rows = [1, 2].map((id) => ({
  id,
  label: `Link ${id}`,
  destination: "https://example.org",
  address: `example.com/${id}`,
  clicks: 0,
  enabled: id === 1,
}));

it("emits all five bulk actions from visibly labelled buttons with Delete last", async () => {
  const onbulk = vi.fn();
  const v = render(Dashboard, {
    state: { kind: "ready", value: simulatedLinkRows },
    selected: [1],
    onbulk,
  });
  expect(v.getByText("1 selected")).toBeTruthy();
  const bar = v.getByRole("toolbar", { name: "Bulk actions" });
  const expected = [
    ["enable", "Enable selected links", "Enable"],
    ["disable", "Disable selected links", "Disable"],
    ["expiration", "Set expiration", "Set expiration"],
    ["retention", "Set retention", "Set retention"],
    ["delete", "Delete selected links", "Delete"],
  ] as const;
  const buttons = within(bar).getAllByRole("button");
  expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(
    expected.map(([, name]) => name),
  );
  for (const [action, name, text] of expected) {
    const button = within(bar).getByRole("button", { name });
    expect(button.textContent?.trim()).toBe(text);
    expect(button.querySelector("svg")).toBeTruthy();
    await fireEvent.click(button);
    expect(onbulk).toHaveBeenLastCalledWith(action);
  }
  expect(onbulk).toHaveBeenCalledTimes(5);
  expect(
    within(bar)
      .getByRole("button", { name: "Set retention" })
      .querySelector("svg.lucide-hourglass"),
  ).toBeTruthy();
  expect(
    within(bar)
      .getByRole("button", { name: "Delete selected links" })
      .classList.contains("btn-danger"),
  ).toBe(true);
});

it("controls visible-row select-all including partial selection without owning state", async () => {
  const onselectall = vi.fn();
  const onselect = vi.fn();
  const state = { kind: "ready" as const, value: simulatedLinkRows };
  const v = render(Dashboard, { state, selected: [1], onselectall, onselect });
  const header = v.getByRole("checkbox", {
    name: "Select all visible links",
  }) as HTMLInputElement;
  expect(header.checked).toBe(false);
  expect(header.indeterminate).toBe(true);
  await fireEvent.click(header);
  expect(onselectall).toHaveBeenLastCalledWith(true);
  await v.rerender({
    state,
    selected: simulatedLinkRows.map((row) => row.id),
    onselectall,
    onselect,
  });
  expect(header.checked).toBe(true);
  expect(header.indeterminate).toBe(false);
  await fireEvent.click(header);
  expect(onselectall).toHaveBeenLastCalledWith(false);
  await fireEvent.click(
    v.getByRole("checkbox", { name: `Select ${simulatedLinkRows[0].label}` }),
  );
  expect(onselect).toHaveBeenCalledExactlyOnceWith(simulatedLinkRows[0].id);
  await v.rerender({ state, mode: "read-only", selected: [1] });
  expect(v.queryAllByRole("checkbox")).toHaveLength(0);
  expect(v.queryByText("1 selected")).toBeNull();
});

describe("dashboard", () => {
  it("emits search and create actions without owning application state", async () => {
    const onsearch = vi.fn();
    const oncreate = vi.fn();
    const view = render(Dashboard, {
      props: {
        state: { kind: "ready", value: [rows[0]] },
        search: "",
        selected: [],
        onsearch,
        oncreate,
      },
    });
    await fireEvent.input(
      view.getByRole("searchbox", { name: "Search links" }),
      { target: { value: "notes" } },
    );
    expect(onsearch).toHaveBeenCalledWith("notes");
    expect(view.getByText("Link 1")).toBeTruthy();
    await fireEvent.click(view.getByText("Create link"));
    expect(oncreate).toHaveBeenCalledOnce();
  });
});

it("shows Statistics and Edit as labelled primary actions under one Actions header", async () => {
  const onaction = vi.fn();
  const v = render(Dashboard, {
    state: { kind: "ready", value: rows },
    onaction,
  });
  const header = v.getByRole("columnheader", { name: "Actions" });
  expect(header.getAttribute("colspan")).toBeNull();
  const headers = v.container.querySelectorAll("thead th").length;
  for (const [index, row] of Array.from(
    v.container.querySelectorAll<HTMLElement>("tbody tr"),
  ).entries()) {
    expect(row.querySelectorAll("td").length).toBe(headers);
    const actions = within(row).getAllByRole("button");
    // Copyable address, Statistics, Edit, More actions.
    expect(actions.map((b) => b.getAttribute("aria-label"))).toEqual([
      `Copy short address example.com/${index + 1}`,
      "View statistics",
      "Edit link",
      `More actions for Link ${index + 1}`,
    ]);
    expect(actions[1].textContent?.trim()).toBe("Statistics");
    expect(actions[2].textContent?.trim()).toBe("Edit");
    await fireEvent.click(actions[1]);
    expect(onaction).toHaveBeenLastCalledWith("stats", index + 1);
    await fireEvent.click(actions[2]);
    expect(onaction).toHaveBeenLastCalledWith("edit", index + 1);
  }
  expect(v.queryByRole("menu")).toBeNull();
});

it("puts copy, events, explicit toggle and separated danger delete in the row menu", async () => {
  const onaction = vi.fn();
  const v = render(Dashboard, {
    state: { kind: "ready", value: rows },
    onaction,
  });
  const open = async (label: string, toggle: string) => {
    const trigger = v.getByRole("button", {
      name: `More actions for ${label}`,
    });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await fireEvent.click(trigger);
    await tick();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = v.getByRole("menu");
    expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Copy address",
      "View events",
      toggle,
      "Delete link",
    ]);
    expect(items[3].classList.contains("danger")).toBe(true);
    expect(items[3].previousElementSibling?.getAttribute("role")).toBe(
      "separator",
    );
    expect(document.activeElement).toBe(items[0]);
    return { trigger, items };
  };
  const first = await open("Link 1", "Disable link");
  await fireEvent.click(first.items[2]);
  expect(onaction).toHaveBeenLastCalledWith("toggle", 1);
  expect(v.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(first.trigger);
  const second = await open("Link 2", "Enable link");
  for (const [index, action] of [
    "copy",
    "events",
    "toggle",
    "delete",
  ].entries()) {
    if (index > 0) {
      await fireEvent.click(second.trigger);
      await tick();
    }
    await fireEvent.click(
      within(v.getByRole("menu")).getAllByRole("menuitem")[index],
    );
    expect(onaction).toHaveBeenLastCalledWith(action, 2);
  }
});

it("supports keyboard navigation, Escape, outside click and a single open menu", async () => {
  const v = render(Dashboard, { state: { kind: "ready", value: rows } });
  const [one, two] = [1, 2].map((id) =>
    v.getByRole("button", { name: `More actions for Link ${id}` }),
  );
  const items = () => within(v.getByRole("menu")).getAllByRole("menuitem");
  one.focus();
  await fireEvent.keyDown(one, { key: "ArrowDown" });
  await tick();
  expect(document.activeElement).toBe(items()[0]);
  await fireEvent.keyDown(items()[0], { key: "ArrowDown" });
  expect(document.activeElement).toBe(items()[1]);
  await fireEvent.keyDown(items()[1], { key: "ArrowUp" });
  await fireEvent.keyDown(items()[0], { key: "ArrowUp" });
  expect(document.activeElement).toBe(items()[3]);
  await fireEvent.keyDown(items()[3], { key: "Home" });
  expect(document.activeElement).toBe(items()[0]);
  await fireEvent.keyDown(items()[0], { key: "End" });
  expect(document.activeElement).toBe(items()[3]);
  await fireEvent.keyDown(items()[3], { key: "Escape" });
  expect(v.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(one);
  expect(one.getAttribute("aria-expanded")).toBe("false");

  await fireEvent.keyDown(one, { key: "ArrowUp" });
  await tick();
  expect(document.activeElement).toBe(items()[3]);
  // Opening another row's menu closes the first one.
  await fireEvent.click(two);
  await tick();
  expect(v.getAllByRole("menu")).toHaveLength(1);
  expect(one.getAttribute("aria-expanded")).toBe("false");
  expect(two.getAttribute("aria-expanded")).toBe("true");
  await fireEvent.pointerDown(document.body);
  expect(v.queryByRole("menu")).toBeNull();

  await fireEvent.click(two);
  await tick();
  const outside = v.getByRole("button", { name: "Create link" });
  await fireEvent.focusOut(items()[0], { relatedTarget: outside });
  expect(v.queryByRole("menu")).toBeNull();
});

it("follows scrolls while its trigger is visible and closes once it leaves", async () => {
  const v = render(Dashboard, { state: { kind: "ready", value: rows } });
  const trigger = v.getByRole("button", { name: "More actions for Link 1" });
  let top = 100;
  trigger.getBoundingClientRect = () =>
    ({ top, bottom: top + 32, left: 0, right: 32 }) as DOMRect;
  await fireEvent.click(trigger);
  await tick();
  // A scroll arriving just after opening (scroll-into-view) keeps it open.
  await fireEvent.scroll(document);
  await fireEvent(window, new Event("resize"));
  expect(v.getByRole("menu")).toBeTruthy();
  expect(v.getByRole("menu").style.top).toBe("136px");
  top = -200;
  await fireEvent.scroll(document);
  expect(v.queryByRole("menu")).toBeNull();
});

it("keeps read-only rows free of actions", () => {
  const v = render(Dashboard, {
    state: { kind: "ready", value: rows },
    mode: "read-only",
  });
  expect(v.queryAllByRole("button")).toHaveLength(0);
  expect(v.queryByRole("columnheader", { name: "Actions" })).toBeNull();
  expect(v.getByText("example.com/1").closest("button")).toBeNull();
});

it("copies when the short address itself is clicked", async () => {
  const onaction = vi.fn();
  const v = render(Dashboard, {
    state: {
      kind: "ready",
      value: [
        {
          id: 7,
          label: "Notes",
          destination: "https://example.org",
          address: "example.com/notes",
          clicks: 0,
          enabled: true,
        },
      ],
    },
    onaction,
  });
  await fireEvent.click(
    v.getByRole("button", { name: "Copy short address example.com/notes" }),
  );
  expect(onaction).toHaveBeenCalledExactlyOnceWith("copy", 7);
});

it("welcomes a user with no links with create and import actions", async () => {
  const oncreate = vi.fn();
  const onbulkcreate = vi.fn();
  const v = render(Dashboard, {
    state: { kind: "ready", value: [] },
    oncreate,
    onbulkcreate,
  });
  const heading = v.getByRole("heading", {
    name: "Create your first short link",
  });
  expect(v.queryByText(/No links match/)).toBeNull();
  const empty = within(heading.parentElement as HTMLElement);
  await fireEvent.click(empty.getByRole("button", { name: "Create link" }));
  await fireEvent.click(empty.getByRole("button", { name: "Import / paste" }));
  expect(oncreate).toHaveBeenCalledOnce();
  expect(onbulkcreate).toHaveBeenCalledOnce();
});

it("distinguishes a search without matches and clears the search", async () => {
  const onsearch = vi.fn();
  const v = render(Dashboard, {
    state: { kind: "ready", value: [] },
    search: "  zebra ",
    onsearch,
  });
  expect(
    v.getByRole("heading", { name: "No links match “zebra”" }),
  ).toBeTruthy();
  expect(v.queryByText("Create your first short link")).toBeNull();
  await fireEvent.click(v.getByRole("button", { name: "Clear search" }));
  expect(onsearch).toHaveBeenCalledExactlyOnceWith("");
});

it("shows a neutral empty message in read-only mode", () => {
  const v = render(Dashboard, {
    state: { kind: "ready", value: [] },
    mode: "read-only",
    search: "anything",
  });
  expect(v.getByRole("heading", { name: "No links" })).toBeTruthy();
  expect(v.queryAllByRole("button")).toHaveLength(0);
});

it("gives every control an explicit accessible name", () => {
  const v = render(Dashboard, {
    state: { kind: "ready", value: rows },
    selected: [1],
  });
  for (const button of v.getAllByRole("button")) {
    const name =
      button.getAttribute("aria-label") ?? button.textContent?.trim();
    expect(name, button.outerHTML).toBeTruthy();
    // Icon-only buttons must carry an explicit aria-label.
    if (!button.textContent?.trim())
      expect(button.getAttribute("aria-label"), button.outerHTML).toBeTruthy();
  }
  for (const box of v.getAllByRole("checkbox"))
    expect(box.getAttribute("aria-label")).toMatch(/^Select /);
});
