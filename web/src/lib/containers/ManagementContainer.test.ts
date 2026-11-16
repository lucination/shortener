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
  await waitFor(() => expect(v.getByText("Clicks per day")).toBeTruthy());
  expect(v.container.querySelector(".focused-dialog")).toBeNull();
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
