import { it, expect } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/svelte";
import AppContainer from "./AppContainer.svelte";
import ManagementContainer from "./ManagementContainer.svelte";
import { createApi } from "../adapters/api";
import { simulatedLinks } from "../fixtures";

const user = {
  id: 1,
  email: "reader@example.org",
  verified_at: null,
  suspended: false,
  deleted_at: null,
  retention_days: 90,
  link_quota: null,
  created_at: "2026-11-14T10:00:00Z",
};
const api = () =>
  createApi(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input) === "/api/me"
            ? user
            : { items: [simulatedLinks[0]], total: 1 },
        ),
      ),
  );

it("opens the complete controlled link editor in a focused dialog and returns to the list on cancel", async () => {
  const v = render(AppContainer, { api: api() });
  await waitFor(() =>
    expect(v.getByRole("heading", { name: "Links" })).toBeTruthy(),
  );
  await waitFor(() =>
    expect(v.getByRole("columnheader", { name: "Clicks" })).toBeTruthy(),
  );
  expect(v.container.textContent).not.toMatch(
    /WORKSPACE|Humans|Human redirects|shorter way/,
  );
  await fireEvent.click(v.getByText("Create link"));
  expect(v.getByRole("dialog").contains(v.getByLabelText("Click limit"))).toBe(
    true,
  );
  expect(v.getByLabelText("Raw event retention (days)")).toBeTruthy();
  expect(v.getByLabelText("Incoming query parameters")).toBeTruthy();
  await fireEvent.click(v.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(v.queryByRole("dialog")).toBeNull());
  expect(v.getByRole("heading", { name: "Links" })).toBeTruthy();
});

it("keeps password removal in its own confirmation without putting the editor in a dialog", async () => {
  history.replaceState(
    null,
    "",
    `/${simulatedLinks[0].addresses[0].short_code}/edit`,
  );
  try {
    const link = { ...simulatedLinks[0], password_protected: true };
    const v = render(ManagementContainer, {
      api: createApi(
        async () => new Response(JSON.stringify({ items: [link], total: 1 })),
      ),
    });
    await waitFor(() =>
      expect(v.getByLabelText("Destination URL")).toBeTruthy(),
    );
    expect(v.queryByRole("dialog")).toBeNull();
    await fireEvent.click(v.getByText("Remove existing password"));
    expect(
      v.getByText("Anyone with the address will be able to open this link."),
    ).toBeTruthy();
    expect(v.getAllByRole("dialog")).toHaveLength(1);
    expect(v.getByRole("button", { name: "Confirm" })).toBeTruthy();
    await fireEvent.click(
      within(v.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(v.queryByRole("dialog")).toBeNull();
  } finally {
    history.replaceState(null, "", "/");
  }
});
