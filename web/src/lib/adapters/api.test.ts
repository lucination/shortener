import { it, expect, vi } from "vitest";
import { createApi } from "./api";
it("checks JSON at the real adapter boundary and uses same-origin cookies", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0 })));
  const result = await createApi(fetcher).links();
  expect(result).toEqual({ kind: "ok", value: { items: [], total: 0 } });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/links",
    expect.objectContaining({ credentials: "same-origin" }),
  );
});
it("does not treat successful HTTP with malformed JSON as typed data", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ items: [{ id: 1 }], total: 1 })),
    );
  expect(await createApi(fetcher).links()).toMatchObject({
    kind: "failed",
    error: { kind: "contract" },
  });
});
it("retains explicit null clearing and omits untouched PATCH fields", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ code: "forbidden", message: "Not your link" }),
        { status: 403 },
      ),
    );
  expect(await createApi(fetcher).patch(7, { title: null })).toEqual({
    kind: "failed",
    error: {
      kind: "http",
      status: 403,
      code: "forbidden",
      message: "Not your link",
    },
  });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/links/7",
    expect.objectContaining({ method: "PATCH", body: '{"title":null}' }),
  );
});
it("models rejected IO separately from server errors", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
  expect(await createApi(fetcher).me()).toMatchObject({
    kind: "failed",
    error: { kind: "network" },
  });
});
