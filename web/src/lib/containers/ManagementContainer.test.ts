import { it, expect, vi, afterEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import ManagementContainer from "./ManagementContainer.svelte";
import { createApi } from "../adapters/api";
import { simulatedLinks, simulatedStats } from "../fixtures";
afterEach(() => history.replaceState(null, "", "/"));
it("loads a direct statistics page through the real adapter without a modal", async () => {
  const link = simulatedLinks[0];
  history.replaceState(null, "", `/${link.addresses[0].short_code}/statistics`);
  const fetcher = vi.fn<typeof fetch>(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input) === "/api/links"
            ? { items: [link], total: 1 }
            : simulatedStats,
        ),
      ),
  );
  const v = render(ManagementContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("Daily activity")).toBeTruthy());
  expect(v.container.querySelector(".focused-dialog")).toBeNull();
  expect(v.container.querySelectorAll(".so-total")).toHaveLength(3);
  expect(v.container.querySelectorAll(".so-ranking")).toHaveLength(3);
  expect(v.container.querySelector(".so-detail-row")?.textContent).toContain(
    "clicks/day",
  );
  expect(v.queryByText("Human redirects", { exact: true })).toBeNull();
  expect(v.queryByText(/Breakdowns include/)).toBeNull();
  expect(v.container.querySelector("[data-metric]")).toBeNull();
  expect(fetcher.mock.calls[1][0]).toContain(`/api/links/${link.id}/stats?`);
});
it("never shows sign-in or owner data after a denied direct load", async () => {
  history.replaceState(null, "", "/notes/edit");
  const v = render(ManagementContainer, {
    api: createApi(
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({ code: "unauthorized", message: "private" }),
            { status: 401 },
          ),
      ),
    ),
  });
  await waitFor(() => expect(v.getByText("Link not found")).toBeTruthy());
  expect(v.queryByText("Send sign-in link")).toBeNull();
});
it("saves only edited fields, preserving exact expiry and untouched settings", async () => {
  const link = {
    ...simulatedLinks[0],
    expires_at: "2030-12-31T12:13:14.123Z",
    interstitial: true,
    query_mode: "preserve" as const,
  };
  history.replaceState(null, "", `/${link.addresses[0].short_code}/edit`);
  const navigate = vi.fn();
  const fetcher = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Response(
        JSON.stringify(
          init?.method === "PATCH" ? link : { items: [link], total: 1 },
        ),
      ),
  );
  const v = render(ManagementContainer, { api: createApi(fetcher), navigate });
  await waitFor(() => expect(v.getByLabelText("Title")).toBeTruthy());
  await fireEvent.input(v.getByLabelText("Title"), {
    target: { value: "Changed title" },
  });
  await fireEvent.submit(v.getByTestId("link-editor"));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    title: "Changed title",
  });
});

it("keeps draft dates and pinned day separate from applied data, resets on apply, and requests arbitrary ranges", async () => {
  const link = simulatedLinks[0];
  history.replaceState(null, "", `/${link.addresses[0].short_code}/statistics`);
  const navigate = vi.fn();
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/links")
      return new Response(JSON.stringify({ items: [link], total: 1 }));
    const from = url.searchParams.get("from")!,
      to = url.searchParams.get("to")!;
    return new Response(
      JSON.stringify({
        ...simulatedStats,
        from,
        to,
        daily: [
          {
            date: from,
            humans: 3,
            bots: 0,
            previews: 0,
            redirects: 3,
            daily_unique: 3,
          },
        ],
      }),
    );
  });
  const v = render(ManagementContainer, {
    api: createApi(fetcher),
    navigate,
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  await waitFor(() =>
    expect(v.container.querySelector('[data-day="2026-11-08"]')).toBeTruthy(),
  );
  await fireEvent.click(v.container.querySelector('[data-day="2026-11-08"]')!);
  expect(v.getByTestId("day-detail").textContent).toContain(
    "2026-11-08 · 3 clicks",
  );
  await fireEvent.input(v.getByLabelText("From"), {
    target: { value: "2026-10-30" },
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(v.getByText("2026-11-08 — 2026-11-14 · UTC")).toBeTruthy();
  expect(v.getByTestId("day-detail").textContent).toContain("2026-11-08");
  await fireEvent.click(v.getByRole("button", { name: "Apply dates" }));
  await waitFor(() =>
    expect(v.getByText("2026-10-30 — 2026-11-14 · UTC")).toBeTruthy(),
  );
  expect(String(fetcher.mock.calls.at(-1)![0])).toContain(
    "from=2026-10-30&to=2026-11-14",
  );
  expect(v.queryByTestId("day-detail")).toBeNull();
  await fireEvent.change(v.getByLabelText("Period"), {
    target: { value: "28" },
  });
  await waitFor(() =>
    expect(v.getByText("2026-10-18 — 2026-11-14 · UTC")).toBeTruthy(),
  );
  await fireEvent.click(v.getByRole("button", { name: "Back to links" }));
  expect(navigate).toHaveBeenCalledWith("/");
});
it("shows request errors with real retry and does not let an older response replace newer observed data", async () => {
  const link = simulatedLinks[0];
  history.replaceState(null, "", `/${link.addresses[0].short_code}/statistics`);
  let attempt = 0;
  let release!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/links")
      return new Response(JSON.stringify({ items: [link], total: 1 }));
    attempt++;
    if (attempt === 1)
      return new Response(
        JSON.stringify({
          code: "unavailable",
          message: "Try the actual retry",
        }),
        { status: 503 },
      );
    if (attempt === 2)
      return new Promise<Response>((resolve) => (release = resolve));
    return new Response(
      JSON.stringify({
        ...simulatedStats,
        from: "2026-10-18",
        to: "2026-11-14",
      }),
    );
  });
  const v = render(ManagementContainer, {
    api: createApi(fetcher),
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  await waitFor(() => expect(v.getByText("Try the actual retry")).toBeTruthy());
  await fireEvent.click(v.getByRole("button", { name: "Retry dates" }));
  expect(v.getByText("Loading statistics…")).toBeTruthy();
  await fireEvent.change(v.getByLabelText("Period"), {
    target: { value: "28" },
  });
  await waitFor(() =>
    expect(v.getByText("2026-10-18 — 2026-11-14 · UTC")).toBeTruthy(),
  );
  release(
    new Response(
      JSON.stringify({
        ...simulatedStats,
        from: "2026-11-08",
        to: "2026-11-14",
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(v.queryByText("2026-11-08 — 2026-11-14 · UTC")).toBeNull();
});

it("keeps a preset selected when the adapter clock crosses a UTC day after mounting", async () => {
  const link = simulatedLinks[0];
  let clock = new Date("2026-11-14T23:59:59Z");
  history.replaceState(null, "", `/${link.addresses[0].short_code}/statistics`);
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    return new Response(
      JSON.stringify(
        url.pathname === "/api/links"
          ? { items: [link], total: 1 }
          : {
              ...simulatedStats,
              from: url.searchParams.get("from"),
              to: url.searchParams.get("to"),
            },
      ),
    );
  });
  const v = render(ManagementContainer, {
    api: createApi(fetcher),
    now: () => clock,
  });
  await waitFor(() => expect(v.getByTestId("human-total")).toBeTruthy());
  clock = new Date("2026-11-15T00:00:01Z");
  await fireEvent.change(v.getByLabelText("Period"), {
    target: { value: "14" },
  });
  await waitFor(() =>
    expect(v.getByText("2026-11-02 — 2026-11-15 · UTC")).toBeTruthy(),
  );
  expect((v.getByLabelText("Period") as HTMLSelectElement).value).toBe("14");
});
