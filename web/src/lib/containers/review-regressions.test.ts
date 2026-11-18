import { it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import AppContainer from "./AppContainer.svelte";
import { createApi } from "../adapters/api";
import { simulatedLinks } from "../fixtures";
import { chooseRowAction, rowMenuTriggers } from "../row-menu-testing";
import { parseBulk } from "../bulk";
import type { BulkInput } from "../generated";
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
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const list = () => json({ items: [simulatedLinks[0]], total: 1 });
const held = () => {
  let release!: (r: Response) => void;
  const response = new Promise<Response>((r) => (release = r));
  return { response, release };
};
const settle = () => new Promise((r) => setTimeout(r, 30));
it("keeps quoted failed CSV records retryable and reports original physical source rows", async () => {
  const bodies: BulkInput[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === "/api/me") return json(user);
    if (String(input) === "/api/links/bulk") {
      bodies.push(JSON.parse(String(init?.body)));
      return json({
        items:
          bodies.length === 1
            ? [
                { index: 0, status: "created", link: simulatedLinks[0] },
                {
                  index: 1,
                  status: "failed",
                  error: { code: "conflict", message: "Reserved" },
                },
              ]
            : [{ index: 0, status: "created", link: simulatedLinks[0] }],
      });
    }
    return list();
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
  );
  await fireEvent.click(v.getByText("Import / paste"));
  const source =
    'destination,alias\n\nhttps://example.org/ok,ok\n\n"https://example.org/a,b?\nq=""yes""",retry';
  await fireEvent.input(v.getByLabelText("URLs / CSV"), {
    target: { value: source },
  });
  await fireEvent.click(v.getByRole("button", { name: "Create 2 links" }));
  await waitFor(() => expect(v.getByText(/Reserved/)).toBeTruthy());
  expect(v.getByText(/Row 5: Reserved/)).toBeTruthy();
  expect(
    parseBulk((v.getByLabelText("URLs / CSV") as HTMLTextAreaElement).value),
  ).toEqual([
    {
      kind: "valid",
      row: 1,
      destination: 'https://example.org/a,b?\nq="yes"',
      alias: "retry",
    },
  ]);
  await fireEvent.click(v.getByRole("button", { name: "Create 1 links" }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]?.items[0]).toEqual(bodies[0]?.items[1]);
});
for (const status of [200, 503])
  for (const target of ["Cancel", "Account", "Links"])
    it(`ignores obsolete import ${status} after ${target}`, async () => {
      const pending = held();
      const fetcher = vi.fn<typeof fetch>(async (input) =>
        String(input) === "/api/me"
          ? json(user)
          : String(input) === "/api/links/bulk"
            ? pending.response
            : list(),
      );
      const v = render(AppContainer, { api: createApi(fetcher) });
      await waitFor(() =>
        expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
      );
      await fireEvent.click(v.getByText("Import / paste"));
      await fireEvent.input(v.getByLabelText("URLs / CSV"), {
        target: { value: "https://example.org/a,a" },
      });
      await fireEvent.click(v.getByRole("button", { name: "Create 1 links" }));
      await fireEvent.click(v.getByRole("button", { name: target }));
      await waitFor(() => expect(v.queryByText("Import links")).toBeNull());
      pending.release(
        status === 200
          ? json({
              items: [{ index: 0, status: "created", link: simulatedLinks[0] }],
            })
          : json({ code: "server", message: "OLD FAILURE" }, status),
      );
      await settle();
      expect(v.queryByText("Import links")).toBeNull();
      expect(v.queryByText("OLD FAILURE")).toBeNull();
    });
for (const status of [200, 503])
  it(`ignores obsolete deletion ${status} after Account`, async () => {
    const pending = held();
    const fetcher = vi.fn<typeof fetch>(async (input, init) =>
      String(input) === "/api/me"
        ? json(user)
        : init?.method === "DELETE"
          ? pending.response
          : list(),
    );
    const v = render(AppContainer, { api: createApi(fetcher) });
    await waitFor(() => expect(rowMenuTriggers().length).toBeGreaterThan(0));
    await chooseRowAction(0, "Delete link");
    await fireEvent.click(v.getByRole("button", { name: "Confirm" }));
    await fireEvent.click(v.getByRole("button", { name: "Account" }));
    await waitFor(() => expect(v.getByText("Raw click data")).toBeTruthy());
    pending.release(
      status === 200
        ? json({ message: "deleted" })
        : json({ code: "server", message: "OLD FAILURE" }, status),
    );
    await settle();
    expect(v.getByText("Raw click data")).toBeTruthy();
    expect(v.queryByText("OLD FAILURE")).toBeNull();
  });
for (const status of [200, 401, 503])
  it(`retries session discovery before protected resources (${status})`, async () => {
    const pending = held();
    let me = 0;
    const calls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      calls.push(path);
      if (path === "/api/me") {
        if (++me === 1)
          return json(
            { code: "server", message: "Temporarily unavailable" },
            503,
          );
        return pending.response;
      }
      return list();
    });
    const v = render(AppContainer, { api: createApi(fetcher) });
    await waitFor(() =>
      expect(v.getByRole("button", { name: "Retry" })).toBeTruthy(),
    );
    await fireEvent.click(v.getByRole("button", { name: "Retry" }));
    await settle();
    expect(calls).toEqual(["/api/me", "/api/me"]);
    pending.release(
      status === 200
        ? json(user)
        : json({ code: "failure", message: "Still unavailable" }, status),
    );
    if (status === 200) {
      await waitFor(() =>
        expect(v.getByRole("button", { name: "Account" })).toBeTruthy(),
      );
      expect(calls).toEqual(["/api/me", "/api/me", "/api/links"]);
    } else if (status === 401) {
      await waitFor(() =>
        expect(v.getByText("Send sign-in link")).toBeTruthy(),
      );
    } else {
      await waitFor(() =>
        expect(v.getByRole("button", { name: "Retry" })).toBeTruthy(),
      );
      expect(v.getByText("Still unavailable")).toBeTruthy();
    }
  });
for (const status of [200, 503])
  it(`keeps replacement commands when an older bulk command completes (${status})`, async () => {
    const pending = held();
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input) === "/api/me"
        ? json(user)
        : String(input) === "/api/links/bulk-update"
          ? pending.response
          : list(),
    );
    const v = render(AppContainer, { api: createApi(fetcher) });
    await waitFor(() =>
      expect(v.getByTitle("Select all visible links")).toBeTruthy(),
    );
    await fireEvent.click(v.getByTitle("Select all visible links"));
    await fireEvent.click(v.getByTitle("Disable selected links"));
    await fireEvent.click(v.getByRole("button", { name: "Confirm" }));
    await fireEvent.click(v.getByTitle("Delete selected links"));
    expect(v.getByText("Delete 1 link?")).toBeTruthy();
    pending.release(
      status === 200
        ? json({ updated: [], items: [] })
        : json({ code: "server", message: "OLD FAILURE" }, status),
    );
    await settle();
    expect(v.getByText("Delete 1 link?")).toBeTruthy();
    expect(v.queryByText("OLD FAILURE")).toBeNull();
  });
