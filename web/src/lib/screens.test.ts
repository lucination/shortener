import { it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Analytics from "./Analytics.svelte";
import AuthPanel from "./AuthPanel.svelte";
import AccountPanel from "./AccountPanel.svelte";
import AdminPanel from "./AdminPanel.svelte";
import PublicPage from "./PublicPage.svelte";
it("admin auth variant never renders magic-link explanatory copy", () => {
  const v = render(AuthPanel, {
    mode: { kind: "admin", token: "" },
    outcome: { kind: "idle" },
  });
  expect(v.queryByText(/No public signup/)).toBeNull();
  expect(v.getByLabelText("Admin token")).toBeTruthy();
});
it("analytics emits a bounded date range query", async () => {
  const onrange = vi.fn();
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
          days: [{ day: "2026-11-14", human: 12 }],
          countries: [{ label: "Unknown", count: 12 }],
          devices: [],
          referrers: [],
        },
      },
    },
    range: { from: "2026-11-01", to: "2026-11-14" },
    onrange,
  });
  await fireEvent.input(v.getByLabelText("From"), {
    target: { value: "2026-11-02" },
  });
  expect(onrange).toHaveBeenCalledWith({
    from: "2026-11-02",
    to: "2026-11-14",
  });
  expect(v.getByText("Clicks", { exact: true })).toBeTruthy();
});
it("magic login emits submission and never sends email itself", async () => {
  const onsubmit = vi.fn();
  const v = render(AuthPanel, {
    mode: { kind: "magic", email: "reader@example.org" },
    outcome: { kind: "idle" },
    onsubmit,
  });
  await fireEvent.submit(v.getByTestId("auth-form"));
  expect(onsubmit).toHaveBeenCalledOnce();
  expect(v.getByText("Sign in with passkey")).toBeTruthy();
});
it("account exposes enrollment and signout without resetting access", async () => {
  const onenroll = vi.fn();
  const v = render(AccountPanel, {
    email: "reader@example.org",
    retention: "90",
    outcome: { kind: "idle" },
    onenroll,
  });
  await fireEvent.click(v.getByText("Add passkey"));
  expect(onenroll).toHaveBeenCalledOnce();
  expect(v.queryByText("Reset access")).toBeNull();
});
it("admin user actions carry durable identity", async () => {
  const onuser = vi.fn();
  const v = render(AdminPanel, {
    view: {
      kind: "users",
      state: {
        kind: "ready",
        value: [
          {
            id: 7,
            email: "reader@example.org",
            status: "active",
            quota: "100",
            retention: "90",
          },
        ],
      },
    },
    outcome: { kind: "idle" },
    onuser,
  });
  await fireEvent.click(v.getByText("Suspend"));
  expect(onuser).toHaveBeenCalledWith("suspend", 7);
});
it("password gate never discloses destination", async () => {
  const oncontinue = vi.fn();
  const v = render(PublicPage, {
    page: { kind: "password", password: "" },
    outcome: { kind: "idle" },
    oncontinue,
  });
  expect(v.queryByText("Destination")).toBeNull();
  await fireEvent.submit(v.getByTestId("password-form"));
  expect(oncontinue).toHaveBeenCalledOnce();
});
it("admin links are a read-only view, not owner mutation controls with no handlers", () => {
  const v = render(AdminPanel, {
    view: { kind: "links", state: { kind: "ready", value: [] } },
    outcome: { kind: "idle" },
  });
  expect(v.queryByText("Create link")).toBeNull();
  expect(v.queryByText("Import / paste")).toBeNull();
});
