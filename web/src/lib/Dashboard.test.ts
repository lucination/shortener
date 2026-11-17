import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Dashboard from "./Dashboard.svelte";
import { simulatedLinkRows } from "./fixtures";

it("emits all five bulk actions from distinct titled icons and retains the count", async () => {
  const onbulk = vi.fn();
  const v = render(Dashboard, {
    state: { kind: "ready", value: simulatedLinkRows },
    selected: [1],
    onbulk,
  });
  expect(v.getByText("1 selected")).toBeTruthy();
  for (const [action, title] of [
    ["enable", "Enable selected links"],
    ["disable", "Disable selected links"],
    ["delete", "Delete selected links"],
    ["expiration", "Set expiration"],
    ["retention", "Set retention"],
  ]) {
    const button = v.getByTitle(title);
    expect(button.querySelector("svg")).toBeTruthy();
    expect(button.textContent?.trim()).toBe("");
    await fireEvent.click(button);
    expect(onbulk).toHaveBeenLastCalledWith(action);
  }
  expect(onbulk).toHaveBeenCalledTimes(5);
});

it("controls visible-row select-all including partial selection without owning state", async () => {
  const onselectall = vi.fn();
  const onselect = vi.fn();
  const state = { kind: "ready" as const, value: simulatedLinkRows };
  const v = render(Dashboard, { state, selected: [1], onselectall, onselect });
  const header = v.getByTitle("Select all visible links") as HTMLInputElement;
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
  await fireEvent.click(v.getByTitle(`Select ${simulatedLinkRows[0].label}`));
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
        state: {
          kind: "ready",
          value: [
            {
              id: 1,
              label: "Field notes",
              destination: "https://example.org/notes",
              address: "example.com/notes",
              clicks: 128,
              enabled: true,
            },
          ],
        },
        search: "",
        selected: [],
        onsearch,
        oncreate,
      },
    });
    await fireEvent.input(
      view.getByPlaceholderText("Search links, destinations, aliases…"),
      { target: { value: "notes" } },
    );
    expect(onsearch).toHaveBeenCalledWith("notes");
    expect(view.getByText("Field notes")).toBeTruthy();
    await fireEvent.click(view.getByText("Create link"));
    expect(oncreate).toHaveBeenCalledOnce();
  });
});
it("puts each icon action in its own stable column with a single grouped header", () => {
  const rows = [1, 2].map((id) => ({
    id,
    label: `Link ${id}`,
    destination: "https://example.org",
    address: `example.com/${id}`,
    clicks: 0,
    enabled: id === 1,
  }));
  const v = render(Dashboard, { state: { kind: "ready", value: rows } });
  expect(v.getByText("Actions").getAttribute("colspan")).toBe("6");
  for (const row of v.container.querySelectorAll("tbody tr")) {
    const buttons = row.querySelectorAll("button[data-action]");
    expect(buttons.length).toBe(6);
    expect(
      new Set(Array.from(buttons).map((button) => button.parentElement)).size,
    ).toBe(6);
    for (const button of buttons) {
      expect(button.querySelector("svg")).toBeTruthy();
      expect(button.textContent?.trim()).toBe("");
      expect(button.getAttribute("title")).toBeTruthy();
    }
  }
  expect(v.getByTitle("Disable link").querySelector("svg")?.outerHTML).not.toBe(
    v.getByTitle("Enable link").querySelector("svg")?.outerHTML,
  );
});

it("keeps controlled copy feedback on durable row identity across reordering and filters", async () => {
  const rows = [1, 2].map((id) => ({
    id,
    label: `Link ${id}`,
    destination: "https://example.org",
    address: `example.com/${id}`,
    clicks: 0,
    enabled: true,
  }));
  const copyFeedback = {
    kind: "success" as const,
    id: 2,
    message: "Short address copied.",
  };
  const v = render(Dashboard, {
    state: { kind: "ready", value: rows },
    copyFeedback,
  });
  expect(v.getByText(copyFeedback.message).getAttribute("data-copy-id")).toBe(
    "2",
  );
  expect(v.getByText(copyFeedback.message).closest("table")).toBeNull();
  await v.rerender({
    state: { kind: "ready", value: [...rows].reverse() },
    copyFeedback,
  });
  expect(v.getByText(copyFeedback.message).getAttribute("data-copy-id")).toBe(
    "2",
  );
  await v.rerender({
    state: { kind: "ready", value: [rows[0]] },
    copyFeedback,
  });
  expect(v.queryByText(copyFeedback.message)).toBeNull();
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
  await fireEvent.click(v.getByText("example.com/notes"));
  expect(onaction).toHaveBeenCalledExactlyOnceWith("copy", 7);
});
