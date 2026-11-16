import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Dashboard from "./Dashboard.svelte";
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
    await fireEvent.click(view.getByText("+ Create link"));
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
