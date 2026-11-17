import { it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import AppContainer from "./AppContainer.svelte";
import { createApi } from "../adapters/api";
const user = {
  id: 1,
  email: "owner@example.test",
  verified_at: "2026-11-17T12:00:00Z",
  suspended: false,
  deleted_at: null,
  retention_days: null,
  link_quota: null,
  created_at: "2026-11-17T12:00:00Z",
};
const metadata = {
  id: 1,
  name: "Chrome extension",
  prefix: "short_at_01234567",
  scope: "links:create",
  created_at: "2026-11-17T12:00:00Z",
  expires_at: "2027-02-15T12:00:00Z",
  last_used_at: null,
};
const token = "short_at_" + "0".repeat(64);
function fixture(hold = false) {
  let release: (value: Response) => void = () => {};
  let listed = false;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (path === "/api/me") return Response.json(user);
    if (path === "/api/auth/logout")
      return Response.json({ message: "signed out" });
    if (path === "/api/account/tokens" && init?.method === "POST") {
      listed = true;
      if (hold) return new Promise((resolve) => (release = resolve));
      return Response.json({ metadata, token });
    }
    if (path === "/api/account/tokens")
      return Response.json({ items: listed ? [metadata] : [] });
    return Response.json({ items: [], total: 0 });
  });
  return {
    fetcher,
    release: () => release(Response.json({ metadata, token })),
  };
}
it("creates once, copies using adapter, and clears secret on navigation", async () => {
  const f = fixture();
  const copy = vi.fn(async () => {});
  const v = render(AppContainer, { api: createApi(f.fetcher), copy });
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Account" }));
  await waitFor(() =>
    expect(v.getByRole("heading", { name: "Access tokens" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Create access token" }));
  await waitFor(() => expect(v.getByDisplayValue(token)).toBeTruthy());
  await fireEvent.click(v.getByRole("button", { name: "Copy token" }));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(token));
  await fireEvent.click(v.getByRole("button", { name: "Links" }));
  expect(v.queryByDisplayValue(token)).toBeNull();
  await fireEvent.click(v.getByRole("button", { name: "Account" }));
  await waitFor(() => expect(v.getByText(/short_at_01234567…/)).toBeTruthy());
  expect(v.queryByDisplayValue(token)).toBeNull();
});
it("does not reveal a held issuance response after leaving Account", async () => {
  const f = fixture(true);
  const v = render(AppContainer, { api: createApi(f.fetcher) });
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Account" }));
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Create access token" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Create access token" }));
  await fireEvent.click(v.getByRole("button", { name: "Links" }));
  f.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(v.queryByDisplayValue(token)).toBeNull();
});

it("clears secret authority immediately on sign out and ignores held creation", async () => {
  const f = fixture(true);
  const v = render(AppContainer, { api: createApi(f.fetcher) });
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Account" }));
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Create access token" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Create access token" }));
  await fireEvent.click(v.getByRole("button", { name: "Sign out" }));
  await waitFor(() =>
    expect(v.queryByRole("button", { name: "Account" })).toBeNull(),
  );
  f.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(v.queryByDisplayValue(token)).toBeNull();
});

it("never reveals a pending token after full document navigation/pagehide", async () => {
  const f = fixture(true);
  const v = render(AppContainer, { api: createApi(f.fetcher) });
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Account" }));
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Create access token" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Create access token" }));
  window.dispatchEvent(new Event("pagehide"));
  f.release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(v.queryByDisplayValue(token)).toBeNull();
});

it("does not carry token metadata into a different account while its loaders are pending", async () => {
  let current = user;
  let calls = 0;
  let release: (value: Response) => void = () => {};
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input);
    if (path === "/api/me") return Response.json(current);
    if (path === "/api/account/passkeys") {
      if (++calls === 2) return new Promise((resolve) => (release = resolve));
      return Response.json({ items: [] });
    }
    if (path === "/api/account/tokens")
      return Response.json({
        items:
          current.id === 1
            ? [{ ...metadata, name: "Old account credential" }]
            : [],
      });
    return Response.json({ items: [], total: 0 });
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Account" }));
  await waitFor(() =>
    expect(v.getByText("Old account credential")).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Links" }));
  current = { ...user, id: 2, email: "other@example.test" };
  await fireEvent.click(v.getByRole("button", { name: "Account" }));
  await waitFor(() => expect(v.getByText("other@example.test")).toBeTruthy());
  try {
    expect(v.queryByText("Old account credential")).toBeNull();
  } finally {
    release(Response.json({ items: [] }));
  }
});
