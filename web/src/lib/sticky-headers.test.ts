import { it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Dashboard from "./Dashboard.svelte";
import AdminPanel from "./AdminPanel.svelte";

const rows = [
  {
    id: 1,
    label: "Long release handbook identity",
    destination: "https://example.org/notes",
    address: "example.com/notes",
    clicks: 3,
    enabled: true,
  },
];

it.each(["manage", "read-only"] as const)(
  "pairs the %s link identity header with only its frozen body column",
  (mode) => {
    const view = render(Dashboard, {
      state: { kind: "ready", value: rows },
      mode,
    });
    const header = view.getByText("Link / destination");
    const body = view.getByText(rows[0].label).closest("td")!;
    expect(header.classList.contains("frozen-identity")).toBe(true);
    expect(body.classList.contains("frozen-identity")).toBe(true);
    expect((header as HTMLTableCellElement).cellIndex).toBe(body.cellIndex);
    expect(view.container.querySelectorAll("th.frozen-identity")).toHaveLength(
      1,
    );
    expect(view.container.querySelectorAll("td.frozen-identity")).toHaveLength(
      1,
    );
  },
);

it("pairs the shared admin user identity header with its frozen body column", () => {
  const view = render(AdminPanel, {
    view: {
      kind: "users",
      state: {
        kind: "ready",
        value: [
          {
            id: 1,
            email: "long-user@example.test",
            status: "active",
            quota: "10",
            retention: "30",
          },
        ],
      },
    },
    outcome: { kind: "idle" },
  });
  expect(view.getByText("User").classList.contains("frozen-identity")).toBe(
    true,
  );
  expect(
    view
      .getByText("long-user@example.test")
      .closest("td")!
      .classList.contains("frozen-identity"),
  ).toBe(true);
});
