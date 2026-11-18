import { it, expect, vi, afterEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import ManagementContainer from "./ManagementContainer.svelte";
import { createApi } from "../adapters/api";
import { simulatedEvents, simulatedLinks, simulatedStats } from "../fixtures";
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

const eventsFetcher = (
  link: (typeof simulatedLinks)[number],
  hold?: (url: URL) => Promise<Response> | undefined,
) =>
  vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input), "http://localhost");
    const held = hold?.(url);
    if (held) return held;
    if (url.pathname === "/api/links")
      return new Response(JSON.stringify({ items: [link], total: 1 }));
    const from = url.searchParams.get("from")!,
      to = url.searchParams.get("to")!;
    if (url.pathname.endsWith("/events"))
      return new Response(
        JSON.stringify({
          items: simulatedEvents,
          total: simulatedEvents.length,
        }),
      );
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
const paths = (fetcher: ReturnType<typeof eventsFetcher>) =>
  fetcher.mock.calls.map(([input]) => String(input));

it("shows events as a lazily loaded view of the same applied range and keeps the fragment client-side", async () => {
  const link = simulatedLinks[0];
  history.replaceState(null, "", `/${link.addresses[0].short_code}/statistics`);
  const fetcher = eventsFetcher(link);
  const v = render(ManagementContainer, {
    api: createApi(fetcher),
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  await waitFor(() => expect(v.getByTestId("human-total")).toBeTruthy());
  expect(paths(fetcher).some((path) => path.includes("/events"))).toBe(false);
  const overview = v.getByRole("tab", { name: "Overview" });
  const events = v.getByRole("tab", { name: "Events" });
  expect(overview.getAttribute("aria-selected")).toBe("true");
  expect(events.getAttribute("aria-selected")).toBe("false");
  // Pin a day; a view switch and a completed events request do not reset it.
  await fireEvent.click(v.container.querySelector('[data-day="2026-11-08"]')!);
  await fireEvent.click(events);
  expect(location.hash).toBe("#events");
  expect(location.pathname).toBe(`/${link.addresses[0].short_code}/statistics`);
  await waitFor(() =>
    expect(v.getByTestId("events-observed").textContent).toContain(
      "2026-11-08 — 2026-11-14 · UTC",
    ),
  );
  expect(v.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
    "statistics-tab-events",
  );
  expect(v.container.querySelectorAll("tbody tr")).toHaveLength(
    simulatedEvents.length,
  );
  expect(v.container.querySelector(".focused-dialog")).toBeNull();
  expect(paths(fetcher).at(-1)).toContain(
    `/api/links/${link.id}/events?from=2026-11-08&to=2026-11-14`,
  );
  await fireEvent.click(v.getByRole("tab", { name: "Overview" }));
  expect(location.hash).toBe("");
  expect(v.getByTestId("day-detail").textContent).toContain("2026-11-08");
  // Returning to a loaded view in the same observation does not refetch.
  await fireEvent.click(v.getByRole("tab", { name: "Events" }));
  expect(
    paths(fetcher).filter((path) => path.includes("/events")),
  ).toHaveLength(1);
  // A new applied range replaces the observation: only the visible view loads.
  await fireEvent.input(v.getByLabelText("From"), {
    target: { value: "2026-11-01" },
  });
  expect(v.getByTestId("events-observed").textContent).toContain("2026-11-08");
  await fireEvent.click(v.getByRole("button", { name: "Apply dates" }));
  await waitFor(() =>
    expect(v.getByTestId("events-observed").textContent).toContain(
      "2026-11-01 — 2026-11-14 · UTC",
    ),
  );
  expect(paths(fetcher).at(-1)).toContain(
    "events?from=2026-11-01&to=2026-11-14",
  );
  expect(paths(fetcher).filter((path) => path.includes("/stats"))).toHaveLength(
    1,
  );
  await fireEvent.click(v.getByRole("tab", { name: "Overview" }));
  await waitFor(() =>
    expect(v.getByText("2026-11-01 — 2026-11-14 · UTC")).toBeTruthy(),
  );
  expect(v.queryByTestId("day-detail")).toBeNull();
  expect(paths(fetcher).at(-1)).toContain(
    "stats?from=2026-11-01&to=2026-11-14",
  );
});

it("opens the events view directly from #events and follows fragment changes", async () => {
  const link = simulatedLinks[0];
  history.replaceState(
    null,
    "",
    `/${link.addresses[0].short_code}/statistics#events`,
  );
  const fetcher = eventsFetcher(link);
  const v = render(ManagementContainer, {
    api: createApi(fetcher),
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  await waitFor(() => expect(v.getByTestId("events-observed")).toBeTruthy());
  expect(
    v.getByRole("tab", { name: "Events" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(paths(fetcher).some((path) => path.includes("/stats"))).toBe(false);
  history.replaceState(null, "", location.pathname);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await waitFor(() => expect(v.getByTestId("human-total")).toBeTruthy());
  expect(
    v.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected"),
  ).toBe("true");
});

it("fences a stale events response behind a newer applied range", async () => {
  const link = simulatedLinks[0];
  history.replaceState(
    null,
    "",
    `/${link.addresses[0].short_code}/statistics#events`,
  );
  let release!: (response: Response) => void;
  let first = true;
  const fetcher = eventsFetcher(link, (url) => {
    if (!url.pathname.endsWith("/events") || !first) return undefined;
    first = false;
    return new Promise<Response>((resolve) => (release = resolve));
  });
  const v = render(ManagementContainer, {
    api: createApi(fetcher),
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  await waitFor(() => expect(v.getByText("Loading events…")).toBeTruthy());
  await fireEvent.change(v.getByLabelText("Period"), {
    target: { value: "28" },
  });
  await waitFor(() =>
    expect(v.getByTestId("events-observed").textContent).toContain(
      "2026-10-18 — 2026-11-14",
    ),
  );
  release(new Response(JSON.stringify({ items: [], total: 0 })));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(v.getByTestId("events-observed").textContent).toContain("2026-10-18");
  expect(v.container.querySelectorAll("tbody tr")).toHaveLength(
    simulatedEvents.length,
  );
});

it("retries a failed events view alone and hides the page after a denied events request", async () => {
  const link = simulatedLinks[0];
  history.replaceState(
    null,
    "",
    `/${link.addresses[0].short_code}/statistics#events`,
  );
  let attempt = 0;
  const fetcher = eventsFetcher(link, (url) => {
    if (!url.pathname.endsWith("/events")) return undefined;
    attempt++;
    if (attempt === 1)
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: "unavailable", message: "Events paused" }),
          { status: 503 },
        ),
      );
    if (attempt === 3)
      return Promise.resolve(
        new Response(JSON.stringify({ code: "not_found", message: "x" }), {
          status: 404,
        }),
      );
    return undefined;
  });
  const v = render(ManagementContainer, {
    api: createApi(fetcher),
    now: () => new Date("2026-11-14T12:00:00Z"),
  });
  await waitFor(() => expect(v.getByText("Events paused")).toBeTruthy());
  await fireEvent.click(v.getByRole("button", { name: "Retry events" }));
  await waitFor(() => expect(v.getByTestId("events-observed")).toBeTruthy());
  expect(paths(fetcher).some((path) => path.includes("/stats"))).toBe(false);
  await fireEvent.click(v.getByRole("button", { name: "Apply dates" }));
  await waitFor(() => expect(v.getByText("Link not found")).toBeTruthy());
  expect(v.queryByRole("tab")).toBeNull();
  expect(v.container.querySelector("tbody")).toBeNull();
});
