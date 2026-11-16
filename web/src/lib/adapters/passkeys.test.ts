import { it, expect, vi } from "vitest";
import {
  startRegistration,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { createApi } from "./api";
import { enrollPasskey, authenticatePasskey } from "./passkeys";
vi.mock("@simplewebauthn/browser", () => ({
  WebAuthnAbortService: { cancelCeremony: vi.fn() },
  startRegistration: vi
    .fn()
    .mockResolvedValue({ id: "credential", type: "public-key" }),
  startAuthentication: vi
    .fn()
    .mockResolvedValue({ id: "credential", type: "public-key" }),
}));
it("passes the real flattened Rust public_key registration envelope to the browser", async () => {
  const public_key = {
    challenge: "AA",
    rp: { id: "localhost", name: "Shortener" },
    user: { id: "AA", name: "reader@example.test", displayName: "Reader" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    authenticatorSelection: {
      residentKey: "preferred",
      requireResidentKey: false,
      userVerification: "required",
    },
    excludeCredentials: [],
    attestation: "none",
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ challenge_id: "challenge", public_key })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ message: "added" })));
  expect(await enrollPasskey(createApi(fetcher), "Test security key")).toEqual({
    kind: "ok",
    value: { message: "added" },
  });
  expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: public_key });
});
it("passes the flattened authentication envelope without inventing a publicKey wrapper", async () => {
  const public_key = {
    challenge: "AA",
    rpId: "localhost",
    allowCredentials: [{ id: "AA", type: "public-key" }],
    userVerification: "required",
  };
  const user = {
    id: 1,
    email: "reader@example.test",
    verified_at: null,
    suspended: false,
    deleted_at: null,
    retention_days: null,
    link_quota: null,
    created_at: "2026-11-14T00:00:00Z",
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ challenge_id: "challenge", public_key })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(user)));
  expect(await authenticatePasskey(createApi(fetcher))).toEqual({
    kind: "ok",
    value: user,
  });
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: public_key });
});

it("requests usernameless options without sending an email", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ error: { kind: "server", message: "Unavailable" } }),
        { status: 503 },
      ),
    );
  await authenticatePasskey(createApi(fetcher));
  const [, options] = fetcher.mock.calls[0];
  expect(JSON.parse(options!.body as string)).toEqual({});
});

const registrationOptions = {
  kind: "ok",
  value: {
    challenge_id: "held",
    public_key: {
      challenge: "AA",
      rp: { name: "Shortener" },
      user: { id: "AA", name: "Reader", displayName: "Reader" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    },
  },
} satisfies Awaited<
  ReturnType<ReturnType<typeof createApi>["registrationOptions"]>
>;
it("abandons delayed registration options before opening a browser ceremony", async () => {
  vi.mocked(startRegistration).mockClear();
  let release!: (value: typeof registrationOptions) => void;
  const api = {
    ...createApi(vi.fn()),
    registrationOptions: vi.fn(
      () =>
        new Promise<typeof registrationOptions>(
          (resolve) => (release = resolve),
        ),
    ),
    register: vi.fn(
      async () => ({ kind: "ok", value: { message: "added" } }) as const,
    ),
  };
  const attempt = new AbortController();
  const result = enrollPasskey(api, "Laptop", { signal: attempt.signal });
  attempt.abort();
  release(registrationOptions);
  expect((await result).kind).toBe("failed");
  expect(startRegistration).not.toHaveBeenCalled();
  expect(api.register).not.toHaveBeenCalled();
});
it("aborts only its owned browser ceremony and fences a late credential", async () => {
  vi.mocked(WebAuthnAbortService.cancelCeremony).mockClear();
  let release!: (value: Awaited<ReturnType<typeof startRegistration>>) => void;
  vi.mocked(startRegistration).mockImplementationOnce(
    () => new Promise((resolve) => (release = resolve)),
  );
  const api = {
    ...createApi(vi.fn()),
    registrationOptions: vi.fn(async () => registrationOptions),
    register: vi.fn(
      async () => ({ kind: "ok", value: { message: "added" } }) as const,
    ),
  };
  const attempt = new AbortController();
  const result = enrollPasskey(api, "Laptop", { signal: attempt.signal });
  await Promise.resolve();
  attempt.abort();
  expect(WebAuthnAbortService.cancelCeremony).toHaveBeenCalledOnce();
  release({ id: "credential", type: "public-key" } as Awaited<
    ReturnType<typeof startRegistration>
  >);
  expect((await result).kind).toBe("failed");
  expect(api.register).not.toHaveBeenCalled();
  vi.mocked(WebAuthnAbortService.cancelCeremony).mockClear();
  // A later abort cannot reach the service-global owner after this attempt settled.
  attempt.abort();
  expect(WebAuthnAbortService.cancelCeremony).not.toHaveBeenCalled();
});

it("releases browser abort ownership before transmitted registration verification", async () => {
  vi.mocked(WebAuthnAbortService.cancelCeremony).mockClear();
  let finish!: (value: { kind: "ok"; value: { message: string } }) => void;
  const api = {
    ...createApi(vi.fn()),
    registrationOptions: vi.fn(async () => registrationOptions),
    register: vi.fn(
      () =>
        new Promise<{ kind: "ok"; value: { message: string } }>(
          (resolve) => (finish = resolve),
        ),
    ),
  };
  const attempt = new AbortController();
  const verifying = vi.fn();
  const result = enrollPasskey(api, "Laptop", {
    signal: attempt.signal,
    onVerifying: verifying,
  });
  await vi.waitFor(() => expect(api.register).toHaveBeenCalledOnce());
  expect(verifying).toHaveBeenCalledOnce();
  attempt.abort();
  expect(WebAuthnAbortService.cancelCeremony).not.toHaveBeenCalled();
  finish({ kind: "ok", value: { message: "added" } });
  expect((await result).kind).toBe("ok");
});

it("does not claim rollback if transmitted verification throws", async () => {
  const api = {
    ...createApi(vi.fn()),
    registrationOptions: vi.fn(async () => registrationOptions),
    register: vi.fn(async () => {
      throw new Error("lost response");
    }),
  };
  const result = await enrollPasskey(api, "Laptop");
  expect(result.kind).toBe("failed");
  if (result.kind === "failed") {
    expect(result.error.message).not.toContain("unchanged");
    expect(result.error.message).toContain("Refresh");
  }
});
