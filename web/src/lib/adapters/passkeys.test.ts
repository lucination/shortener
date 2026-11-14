import { it, expect, vi } from "vitest";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { createApi } from "./api";
import { enrollPasskey, authenticatePasskey } from "./passkeys";
vi.mock("@simplewebauthn/browser", () => ({
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
  expect(await enrollPasskey(createApi(fetcher))).toEqual({
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
  expect(await authenticatePasskey(createApi(fetcher), user.email)).toEqual({
    kind: "ok",
    value: user,
  });
  expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: public_key });
});
