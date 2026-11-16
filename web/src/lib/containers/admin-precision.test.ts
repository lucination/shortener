import { it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/svelte";
import AdminContainer from "../../../../admin/src/AdminContainer.svelte";
import { simulatedUsers } from "../fixtures";
afterEach(() => vi.unstubAllGlobals());
it("withholds administrator navigation while initial authority is unknown", async () => {
  let release!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => (release = resolve));
  const fetcher = vi.fn<typeof fetch>(() => held);
  vi.stubGlobal("fetch", fetcher);
  const v = render(AdminContainer);
  try {
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(v.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(v.queryByRole("button", { name: "Users" })).toBeNull();
  } finally {
    release(
      new Response(
        JSON.stringify({ code: "unauthorized", message: "Sign in" }),
        { status: 401 },
      ),
    );
  }
});
it("keeps failed administrator discovery signed out and admits navigation only after a successful retry", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "unavailable",
            message: "Initial administrator read failed",
          }),
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: simulatedUsers,
            total: simulatedUsers.length,
          }),
        ),
      ),
  );
  const v = render(AdminContainer);
  await waitFor(() =>
    expect(v.getByText("Initial administrator read failed")).toBeTruthy(),
  );
  expect(v.queryByRole("button", { name: "Sign out" })).toBeNull();
  expect(v.queryByRole("button", { name: "Users" })).toBeNull();
  await fireEvent.click(v.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Users" })).toBeTruthy(),
  );
});
it("mounts the separate actual administrator container and persists a quota edit through its real API adapter", async () => {
  let signedIn = false;
  let users = simulatedUsers.map((user) => ({ ...user }));
  const calls: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const path = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ path, body });
      if (path === "/_/api/login") {
        signedIn = true;
        return new Response(JSON.stringify({ message: "signed in" }));
      }
      if (!signedIn)
        return new Response(
          JSON.stringify({ code: "unauthorized", message: "Sign in" }),
          { status: 401 },
        );
      if (path === "/_/api/users/1" && init?.method === "PATCH") {
        users = users.map((user) =>
          user.id === 1 ? { ...user, link_quota: body.link_quota } : user,
        );
        return new Response(JSON.stringify(users[0]));
      }
      return new Response(
        JSON.stringify({ items: users, total: users.length }),
      );
    }),
  );
  const v = render(AdminContainer);
  await waitFor(() => expect(v.getByLabelText("Admin token")).toBeTruthy());
  await fireEvent.input(v.getByLabelText("Admin token"), {
    target: { value: "isolated-test-token" },
  });
  await fireEvent.submit(v.getByTestId("auth-form"));
  await waitFor(() =>
    expect(v.getByRole("heading", { name: "Users" })).toBeTruthy(),
  );
  await waitFor(() =>
    expect(v.getByRole("button", { name: "100" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "100" }));
  expect(v.getByRole("dialog").contains(v.getByLabelText("Link quota"))).toBe(
    true,
  );
  await fireEvent.input(v.getByLabelText("Link quota"), {
    target: { value: "0" },
  });
  await fireEvent.click(v.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(v.getByRole("button", { name: "0" })).toBeTruthy(),
  );
  expect(calls.find((call) => call.path === "/_/api/users/1")?.body).toEqual({
    suspended: null,
    deleted: null,
    link_quota: 0,
  });
  expect(calls.every((call) => call.path.startsWith("/_/api/"))).toBe(true);
});
