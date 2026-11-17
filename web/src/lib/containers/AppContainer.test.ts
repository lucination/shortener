import {
  startRegistration,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
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
it("uses exact same-origin short-code URLs for statistics and edit actions", async () => {
  const navigateTo = vi.fn();
  const fetcher = vi.fn<typeof fetch>(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input) === "/api/me"
            ? user
            : { items: [simulatedLinks[0]], total: 1 },
        ),
      ),
  );
  const v = render(AppContainer, { api: createApi(fetcher), navigateTo });
  await waitFor(() => expect(v.getByTitle("View statistics")).toBeTruthy());
  await fireEvent.click(v.getByTitle("View statistics"));
  expect(navigateTo).toHaveBeenLastCalledWith(
    `/${simulatedLinks[0].addresses[0].short_code}/statistics`,
  );
  await fireEvent.click(v.getByTitle("Edit link"));
  expect(navigateTo).toHaveBeenLastCalledWith(
    `/${simulatedLinks[0].addresses[0].short_code}/edit`,
  );
});
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
  await waitFor(() =>
    expect(v.getByTitle("Select all visible links")).toBeTruthy(),
  );
  await fireEvent.click(v.getByTitle("Select all visible links"));
  await fireEvent.click(v.getByTitle("Disable selected links"));
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
  await fireEvent.click(v.getAllByText("Create link")[0]);
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
  await fireEvent.click(v.getAllByText("Create link")[0]);
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

it("shows a transient bottom toast only after clicking the address and clipboard success", async () => {
  let complete!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const fetcher = vi.fn<typeof fetch>(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input) === "/api/me"
            ? user
            : { items: simulatedLinks.slice(0, 2), total: 2 },
        ),
      ),
  );
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getAllByTitle("Copy address").length).toBe(2));
  await fireEvent.click(v.getAllByTitle("Copy short address")[0]);
  expect(v.queryByText("Short address copied.")).toBeNull();
  const address = simulatedLinks[0].addresses[0];
  expect(writeText).toHaveBeenCalledWith(
    `https://${address.domain}/${address.short_code}`,
  );
  complete();
  await waitFor(() =>
    expect(v.getByText("Short address copied.").closest("table")).toBeNull(),
  );
  expect(
    v.getByText("Short address copied.").classList.contains("copy-feedback"),
  ).toBe(true);
  expect(v.container.querySelectorAll(".copy-feedback").length).toBe(1);
  vi.useFakeTimers();
  // A replacement attempt clears old success before the next browser result.
  await fireEvent.click(v.getAllByTitle("Copy address")[1]);
  expect(v.queryByText("Short address copied.")).toBeNull();
  complete();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(3500);
  expect(v.queryByText("Short address copied.")).toBeNull();
  vi.useRealTimers();
});

it("keeps only the newest copy result and ignores stale completion after navigation", async () => {
  const pending: { resolve: () => void; reject: () => void }[] = [];
  const copy = vi.fn(
    () =>
      new Promise<void>((resolve, reject) =>
        pending.push({ resolve, reject: () => reject(new Error("denied")) }),
      ),
  );
  const fetcher = vi.fn<typeof fetch>(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input) === "/api/me"
            ? user
            : { items: simulatedLinks.slice(0, 2), total: 2 },
        ),
      ),
  );
  const v = render(AppContainer, { api: createApi(fetcher), copy });
  await waitFor(() => expect(v.getAllByTitle("Copy address").length).toBe(2));
  await fireEvent.click(v.getAllByTitle("Copy address")[0]);
  await fireEvent.click(v.getAllByTitle("Copy address")[1]);
  pending[1].reject();
  await waitFor(() =>
    expect(v.getByText(/Clipboard unavailable/)).toBeTruthy(),
  );
  expect(
    v.getByText(/Clipboard unavailable/).getAttribute("data-copy-id"),
  ).toBe(String(simulatedLinks[1].id));
  pending[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(v.queryByText("Short address copied.")).toBeNull();
  await fireEvent.click(v.getAllByTitle("Copy address")[0]);
  await fireEvent.click(v.getByRole("button", { name: /^Account$/ }));
  await waitFor(() => expect(v.getByText("Raw click data")).toBeTruthy());
  pending[2].resolve();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(v.queryByText("Short address copied.")).toBeNull();
  expect(v.queryByText(/Clipboard unavailable/)).toBeNull();
});

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(async () => ({
    id: "credential",
    type: "public-key",
  })),
  startAuthentication: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));
it("retains an abandoned enrollment barrier through Account replacement and prevents stale registration", async () => {
  let release!: (value: Response) => void;
  const held = new Promise<Response>((resolve) => (release = resolve));
  const options = {
    challenge_id: "held",
    public_key: {
      challenge: "AA",
      rp: { name: "Shortener" },
      user: { id: "AA", name: "Reader", displayName: "Reader" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    },
  };
  let optionCount = 0;
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input);
    if (path === "/api/me") return new Response(JSON.stringify(user));
    if (path.endsWith("register/options")) {
      optionCount++;
      return optionCount === 1 ? held : new Response(JSON.stringify(options));
    }
    if (path.endsWith("register/verify"))
      return new Response(JSON.stringify({ message: "added" }));
    return new Response(JSON.stringify({ items: [], total: 0 }));
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("No matching links")).toBeTruthy());
  const account = async () => {
    await fireEvent.click(v.getByRole("button", { name: /^Account$/ }));
    await waitFor(() =>
      expect(v.getByLabelText("New passkey name")).toBeTruthy(),
    );
  };
  await account();
  for (const invalid of [" ", "🔑".repeat(81), "bad\u0080name"]) {
    await fireEvent.input(v.getByLabelText("New passkey name"), {
      target: { value: invalid },
    });
    await fireEvent.click(v.getByRole("button", { name: "Add passkey" }));
    expect(optionCount).toBe(0);
  }
  await fireEvent.input(v.getByLabelText("New passkey name"), {
    target: { value: "Abandoned" },
  });
  await fireEvent.click(v.getByRole("button", { name: "Add passkey" }));
  await waitFor(() => expect(optionCount).toBe(1));
  await fireEvent.click(v.getByRole("button", { name: /^Links$/ }));
  await account();
  const button = v.getByRole("button", {
    name: "Add passkey",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  release(new Response(JSON.stringify(options)));
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(
    fetcher.mock.calls.filter(([path]) =>
      String(path).endsWith("register/verify"),
    ),
  ).toHaveLength(0);
  await fireEvent.input(v.getByLabelText("New passkey name"), {
    target: { value: "🔑".repeat(80) },
  });
  await fireEvent.click(button);
  await waitFor(() =>
    expect(v.getByText("Passkey added to your account.")).toBeTruthy(),
  );
  expect(optionCount).toBe(2);
});

for (const leave of ["navigation", "logout", "unmount"] as const)
  it(`fences held browser registration after ${leave}`, async () => {
    vi.mocked(WebAuthnAbortService.cancelCeremony).mockClear();
    let finish!: (value: Awaited<ReturnType<typeof startRegistration>>) => void;
    vi.mocked(startRegistration).mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path === "/api/me") return new Response(JSON.stringify(user));
      if (path.endsWith("register/options"))
        return new Response(
          JSON.stringify({
            challenge_id: "held",
            public_key: {
              challenge: "AA",
              rp: { name: "Shortener" },
              user: { id: "AA", name: "Reader", displayName: "Reader" },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            },
          }),
        );
      if (path === "/api/auth/logout")
        return new Response(JSON.stringify({ message: "Signed out" }));
      return new Response(JSON.stringify({ items: [], total: 0 }));
    });
    const v = render(AppContainer, { api: createApi(fetcher) });
    await waitFor(() => expect(v.getByText("No matching links")).toBeTruthy());
    await fireEvent.click(v.getByRole("button", { name: /^Account$/ }));
    await waitFor(() =>
      expect(v.getByLabelText("New passkey name")).toBeTruthy(),
    );
    await fireEvent.input(v.getByLabelText("New passkey name"), {
      target: { value: "Laptop" },
    });
    await fireEvent.click(v.getByRole("button", { name: "Add passkey" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    if (leave === "unmount") v.unmount();
    else
      await fireEvent.click(
        v.getByRole("button", {
          name: leave === "logout" ? /^Sign out$/ : /^Links$/,
        }),
      );
    expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalledOnce();
    finish({ id: "credential", type: "public-key" } as Awaited<
      ReturnType<typeof startRegistration>
    >);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      fetcher.mock.calls.filter(([path]) =>
        String(path).endsWith("register/verify"),
      ),
    ).toHaveLength(0);
  });
it("validates rename names with the same scalar/control policy before submitting", async () => {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (path === "/api/me") return new Response(JSON.stringify(user));
    if (init?.method === "PATCH")
      return new Response(
        JSON.stringify({ id: 7, name: JSON.parse(String(init.body)).name }),
      );
    return new Response(
      JSON.stringify({
        items:
          path === "/api/account/passkeys" ? [{ id: 7, name: "Laptop" }] : [],
        total: 0,
      }),
    );
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("No matching links")).toBeTruthy());
  await fireEvent.click(v.getByRole("button", { name: /^Account$/ }));
  await waitFor(() => expect(v.getByLabelText("Passkey name")).toBeTruthy());
  for (const name of ["x".repeat(81), "🔑".repeat(81), "bad\u0080name"]) {
    await fireEvent.input(v.getByLabelText("Passkey name"), {
      target: { value: name },
    });
    await fireEvent.click(v.getByRole("button", { name: "Rename" }));
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  }
  await fireEvent.input(v.getByLabelText("Passkey name"), {
    target: { value: "🔑".repeat(80) },
  });
  await fireEvent.click(v.getByRole("button", { name: "Rename" }));
  await waitFor(() => expect(v.getByText("Passkey renamed.")).toBeTruthy());
});

it("releases abandoned enrollment progress after cancelling a session command", async () => {
  let finish!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => (finish = resolve));
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const path = String(input);
    if (path === "/api/me") return new Response(JSON.stringify(user));
    if (path.endsWith("register/options")) return held;
    return new Response(JSON.stringify({ items: [], total: 0 }));
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByText("No matching links")).toBeTruthy());
  await fireEvent.click(v.getByRole("button", { name: /^Account$/ }));
  await waitFor(() =>
    expect(v.getByLabelText("New passkey name")).toBeTruthy(),
  );
  await fireEvent.input(v.getByLabelText("New passkey name"), {
    target: { value: "Laptop" },
  });
  await fireEvent.click(v.getByRole("button", { name: "Add passkey" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([path]) =>
        String(path).endsWith("register/options"),
      ),
    ).toBe(true),
  );
  await fireEvent.click(v.getByRole("button", { name: "Sign out everywhere" }));
  await fireEvent.click(v.getByRole("button", { name: "Cancel" }));
  finish(
    new Response(
      JSON.stringify({ code: "unavailable", message: "held failure" }),
      { status: 503 },
    ),
  );
  await waitFor(() =>
    expect(
      (v.getByRole("button", { name: "Add passkey" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
});
