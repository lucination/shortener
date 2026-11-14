import { it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import AppContainer from "./AppContainer.svelte";
import { createApi } from "../adapters/api";
import { simulatedLinks } from "../fixtures";
const user = {
  id: 1,
  email: "reader@example.org",
  verified_at: "2026-11-14T10:00:00Z",
  suspended: false,
  deleted_at: null,
  retention_days: 90,
  link_quota: null,
  created_at: "2026-11-14T10:00:00Z",
};
it("keeps per-link bulk failures beside the affected confirmation instead of claiming success", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === "/api/me") return new Response(JSON.stringify(user));
    if (String(input) === "/api/links/bulk-update")
      return new Response(
        JSON.stringify({
          updated: [],
          items: [
            {
              status: "failed",
              index: 0,
              id: simulatedLinks[0].id,
              error: {
                code: "not_found",
                message: "Link is no longer available",
              },
            },
          ],
        }),
      );
    return new Response(
      JSON.stringify({ items: [simulatedLinks[0]], total: 1 }),
    );
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByRole("checkbox")).toBeTruthy());
  await fireEvent.click(v.getByRole("checkbox"));
  await fireEvent.click(v.getByRole("button", { name: "disable" }));
  await fireEvent.click(v.getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(v.getByText(/Link is no longer available/)).toBeTruthy(),
  );
  expect(v.getByRole("button", { name: "Confirm" })).toBeTruthy();
});
it("runs session -> list -> controlled editor -> actual API adapter save lifecycle", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    calls.push({
      path,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (path === "/api/me") return new Response(JSON.stringify(user));
    if (path === "/api/links" && init?.method === "POST")
      return new Response(
        JSON.stringify({ code: "alias_reserved", message: "Alias reserved" }),
        { status: 409 },
      );
    return new Response(JSON.stringify({ items: [], total: 0 }));
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("No matching links")).toBeTruthy());
  await fireEvent.click(v.getByText("+ Create link"));
  await fireEvent.input(v.getByLabelText("Destination URL"), {
    target: { value: "https://example.org" },
  });
  await fireEvent.submit(v.getByTestId("link-editor"));
  await waitFor(() => expect(v.getByText("Alias reserved")).toBeTruthy());
  expect(calls.map((c) => c.path)).toEqual([
    "/api/me",
    "/api/links",
    "/api/links",
  ]);
  expect(calls[2]?.body).toMatchObject({
    destination: "https://example.org",
    query_mode: "discard",
  });
});
it("renders sign-in after unauthorized session without inventing data", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ code: "unauthorized", message: "Sign in" }),
        { status: 401 },
      ),
    );
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("Send sign-in link")).toBeTruthy());
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("an admin-only cookie never replaces user sign-in authority", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ code: "forbidden", message: "User session required" }),
        { status: 403 },
      ),
    );
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("Send sign-in link")).toBeTruthy());
  expect(v.queryByRole("button", { name: /^Account$/ })).toBeNull();
});
it("does not let an old completed save replace a newly selected screen", async () => {
  let resolveSave: (response: Response) => void = () => {};
  const held = new Promise<Response>((resolve) => (resolveSave = resolve));
  const fetcher = vi.fn<typeof fetch>(async (input, init) =>
    String(input) === "/api/me"
      ? new Response(JSON.stringify(user))
      : init?.method === "POST"
        ? held
        : new Response(JSON.stringify({ items: [], total: 0 })),
  );
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("No matching links")).toBeTruthy());
  await fireEvent.click(v.getByText("+ Create link"));
  await fireEvent.input(v.getByLabelText("Destination URL"), {
    target: { value: "https://example.org" },
  });
  await fireEvent.submit(v.getByTestId("link-editor"));
  await fireEvent.click(v.getByRole("button", { name: /^Account$/ }));
  resolveSave(new Response(JSON.stringify(simulatedLinks[0])));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await waitFor(() => expect(v.getByText("Raw click data")).toBeTruthy());
  expect(v.queryByText("Your links")).toBeNull();
});
