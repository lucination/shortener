import { it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import AccountPanel from "./AccountPanel.svelte";
import AdminPanel from "./AdminPanel.svelte";
import Analytics from "./Analytics.svelte";
import PublicPage from "./PublicPage.svelte";
import AuthPanel from "./AuthPanel.svelte";
import EventTable from "./EventTable.svelte";
import { simulatedEventRows } from "./fixtures";
it("shows one administrator link failure with a working retry", async () => {
  const onretry = vi.fn();
  const v = render(AdminPanel, {
    view: {
      kind: "links",
      state: { kind: "error", message: "Link list unavailable" },
    },
    outcome: { kind: "idle" },
    onretry,
  });
  expect(v.getAllByText("Link list unavailable")).toHaveLength(1);
  await fireEvent.click(v.getByRole("button", { name: "Retry" }));
  expect(onretry).toHaveBeenCalledOnce();
});
it("keeps administrator sign-in to one heading and its real token form", () => {
  const v = render(AuthPanel, {
    mode: { kind: "admin", token: "" },
    outcome: { kind: "idle" },
  });
  expect(v.getAllByRole("heading")).toHaveLength(1);
  expect(v.container.textContent).not.toMatch(
    /never stored|configured admin token/,
  );
  expect(v.getByLabelText("Admin token")).toBeTruthy();
});
it("labels retained human events as clicks without altering event data", () => {
  const v = render(EventTable, { rows: simulatedEventRows });
  expect(v.getByText("Click", { exact: true })).toBeTruthy();
  expect(v.container.textContent).not.toMatch(/human/i);
});
it("keeps the public unavailable page literal without duplicate breadcrumbs", () => {
  const v = render(PublicPage, {
    page: { kind: "not-found" },
    outcome: { kind: "idle" },
  });
  expect(v.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(v.container.textContent).not.toMatch(
    /SHORT LINKS|Nothing to redirect/,
  );
});
it("keeps account focused on its real controls without workspace breadcrumbs", () => {
  const v = render(AccountPanel, {
    email: "reader@example.test",
    retention: "90",
    outcome: { kind: "idle" },
  });
  expect(v.container.textContent).not.toContain("WORKSPACE");
  expect(v.getByRole("heading", { level: 1 }).textContent).toBe("Account");
  expect(v.getByText("Add passkey")).toBeTruthy();
  expect(v.getByText("Sign out everywhere")).toBeTruthy();
});
it("renders one screen heading for the separate administrator link view", () => {
  const v = render(AdminPanel, {
    view: { kind: "links", state: { kind: "ready", value: [] } },
    outcome: { kind: "idle" },
  });
  expect(v.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(v.container.textContent).not.toMatch(
    /ADMINISTRATION|shorter way|Human/,
  );
});
it("retains Clicks as the primary metric label without workspace chrome", () => {
  const v = render(Analytics, {
    view: {
      kind: "stats",
      label: "Field notes",
      state: {
        kind: "ready",
        value: {
          human: 12,
          bot: 2,
          preview: 3,
          days: [],
          countries: [],
          devices: [],
          referrers: [],
        },
      },
    },
    range: { from: "2026-11-01", to: "2026-11-14" },
  });
  expect(v.getByText("Clicks", { exact: true })).toBeTruthy();
  expect(v.container.textContent).not.toMatch(
    /approximate|must not be summed|WORKSPACE|Daily UTC|Inclusive dates/,
  );
  expect(v.container.querySelectorAll(".so-total")).toHaveLength(3);
});
