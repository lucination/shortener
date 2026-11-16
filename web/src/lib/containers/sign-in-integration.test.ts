import { startAuthentication } from "@simplewebauthn/browser";
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
}));
import { it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import AppContainer from "./AppContainer.svelte";
import { createApi } from "../adapters/api";

it("mounts the approved sign-in presentation on anonymous discovery and retains email through actual adapter outcomes", async () => {
  let release!: (r: Response) => void;
  const held = new Promise<Response>((r) => (release = r));
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    String(input) === "/api/me"
      ? new Response(
          JSON.stringify({ code: "unauthorized", message: "Sign in" }),
          { status: 401 },
        )
      : held,
  );
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() =>
    expect(v.getByRole("heading", { name: "Sign in" })).toBeTruthy(),
  );
  expect(v.container.querySelector(".si-page")).toBeTruthy();
  expect(v.container.querySelector(".app-shell")).toBeNull();
  expect(v.queryByRole("button", { name: "Account" })).toBeNull();
  expect(v.getAllByText("Shortener")).toHaveLength(1);
  const email = v.getByLabelText("Email") as HTMLInputElement;
  await fireEvent.input(email, { target: { value: "reader@example.org" } });
  await fireEvent.submit(v.container.querySelector("form")!);
  expect(v.getByRole("button", { name: "Sending link…" })).toBeTruthy();
  expect(email.value).toBe("reader@example.org");
  release(new Response(JSON.stringify({ message: "Check your inbox" })));
  await waitFor(() =>
    expect(v.getByRole("button", { name: "Send another link" })).toBeTruthy(),
  );
  expect(email.value).toBe("reader@example.org");
  expect(fetcher.mock.calls[1][0]).toBe("/api/auth/magic-link");
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({
    email: "reader@example.org",
  });
});

it("cancels held usernameless options without launching a stale picker and preserves email", async () => {
  let release!: (r: Response) => void;
  const held = new Promise<Response>((r) => (release = r));
  const fetcher = vi.fn<typeof fetch>(async (input) =>
    String(input) === "/api/me"
      ? new Response(
          JSON.stringify({ code: "unauthorized", message: "Sign in" }),
          { status: 401 },
        )
      : held,
  );
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByLabelText("Email")).toBeTruthy());
  await fireEvent.click(
    v.getByRole("button", { name: "Sign in with passkey" }),
  );
  expect(v.getByRole("button", { name: "Waiting for passkey…" })).toBeTruthy();
  expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({});
  await fireEvent.click(v.getByRole("button", { name: "Cancel" }));
  expect(v.getByText(/Passkey sign-in was cancelled/)).toBeTruthy();
  expect(
    (
      v.getByRole("button", {
        name: "Cancelling passkey…",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  release(
    new Response(
      JSON.stringify({
        challenge_id: "held",
        public_key: {
          challenge: "AA",
          rpId: "localhost",
          userVerification: "required",
        },
      }),
    ),
  );
  await new Promise((r) => setTimeout(r, 30));
  expect(startAuthentication).not.toHaveBeenCalled();
  expect(v.getByText(/Passkey sign-in was cancelled/)).toBeTruthy();
  expect((v.getByLabelText("Email") as HTMLInputElement).value).toBe("");
});

it("stops offering cancellation once the assertion has been submitted for session creation", async () => {
  vi.mocked(startAuthentication).mockResolvedValue({
    id: "credential",
    type: "public-key",
  } as never);
  let release!: (r: Response) => void;
  const held = new Promise<Response>((r) => (release = r));
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === "/api/me")
      return new Response(
        JSON.stringify({ code: "unauthorized", message: "Sign in" }),
        { status: 401 },
      );
    if (url.endsWith("/options"))
      return new Response(
        JSON.stringify({
          challenge_id: "held",
          public_key: {
            challenge: "AA",
            rpId: "localhost",
            userVerification: "required",
          },
        }),
      );
    return held;
  });
  const v = render(AppContainer, { api: createApi(fetcher) });
  await waitFor(() => expect(v.getByLabelText("Email")).toBeTruthy());
  await fireEvent.click(
    v.getByRole("button", { name: "Sign in with passkey" }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(v.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(v.getByRole("button", { name: "Signing in…" })).toBeTruthy();
  release(
    new Response(
      JSON.stringify({ code: "unavailable", message: "Please try again" }),
      { status: 503 },
    ),
  );
  await waitFor(() => expect(v.getByText("Please try again")).toBeTruthy());
});

for (const status of [400, 401, 403, 429, 503])
  it(`keeps entered email on an actual ${status} adapter error and retries in place`, async () => {
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>(async (input) =>
      String(input) === "/api/me"
        ? new Response(
            JSON.stringify({ code: "unauthorized", message: "Sign in" }),
            { status: 401 },
          )
        : ++calls === 1
          ? new Response(
              JSON.stringify({
                code: "unavailable",
                message: `Email request failed ${status}`,
              }),
              { status },
            )
          : new Response(JSON.stringify({ message: "Accepted" })),
    );
    const v = render(AppContainer, { api: createApi(fetcher) });
    await waitFor(() => expect(v.getByLabelText("Email")).toBeTruthy());
    const email = v.getByLabelText("Email") as HTMLInputElement;
    await fireEvent.input(email, { target: { value: "reader@example.org" } });
    await fireEvent.submit(v.container.querySelector("form")!);
    await waitFor(() =>
      expect(v.getByText(`Email request failed ${status}`)).toBeTruthy(),
    );
    expect(email.value).toBe("reader@example.org");
    await fireEvent.click(v.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(v.getByText(/If this email belongs/)).toBeTruthy(),
    );
    expect(email.value).toBe("reader@example.org");
  });
