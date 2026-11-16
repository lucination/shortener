import { z } from "zod";
import {
  startRegistration,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type { Api, Result } from "./api";
import type { User, Message } from "../generated";
const descriptor = z.object({
  id: z.string(),
  type: z.literal("public-key"),
  transports: z
    .array(
      z.enum([
        "ble",
        "cable",
        "hybrid",
        "internal",
        "nfc",
        "smart-card",
        "usb",
      ]),
    )
    .optional(),
});
const creation = z.object({
  challenge: z.string(),
  rp: z.object({ id: z.string().optional(), name: z.string() }),
  user: z.object({
    id: z.string(),
    name: z.string(),
    displayName: z.string(),
  }),
  pubKeyCredParams: z.array(
    z.object({ type: z.literal("public-key"), alg: z.number().int() }),
  ),
  timeout: z.number().optional(),
  excludeCredentials: z.array(descriptor).optional(),
  attestation: z.enum(["none", "indirect", "direct", "enterprise"]).optional(),
  authenticatorSelection: z
    .object({
      authenticatorAttachment: z
        .enum(["platform", "cross-platform"])
        .optional(),
      residentKey: z.enum(["discouraged", "preferred", "required"]).optional(),
      requireResidentKey: z.boolean().optional(),
      userVerification: z
        .enum(["required", "preferred", "discouraged"])
        .optional(),
    })
    .optional(),
});
const authentication = z.object({
  challenge: z.string(),
  rpId: z.string().optional(),
  timeout: z.number().optional(),
  allowCredentials: z.array(descriptor).optional(),
  userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
});
export async function enrollPasskey(
  api: Api,
  name: string,
  {
    signal,
    onVerifying = () => {},
  }: { signal?: AbortSignal; onVerifying?: () => void } = {},
): Promise<Result<Message>> {
  const cancelled = {
    kind: "failed",
    error: {
      kind: "contract",
      message: "Passkey enrollment was cancelled before verification.",
    },
  } as const;
  if (signal?.aborted) return cancelled;
  const result = await api.registrationOptions();
  if (signal?.aborted) return cancelled;
  if (result.kind === "failed") return result;
  const cancel = () => WebAuthnAbortService.cancelCeremony();
  signal?.addEventListener("abort", cancel, { once: true });
  let stage: "ceremony" | "verification" = "ceremony";
  try {
    const options = creation.parse(result.value.public_key);
    const credential = await startRegistration({
      optionsJSON: options,
    });
    const json: unknown = JSON.parse(JSON.stringify(credential));
    if (signal?.aborted) return cancelled;
    // Browser ownership ends before verification. A transmitted registration
    // cannot be cancelled or truthfully described as rolled back.
    signal?.removeEventListener("abort", cancel);
    stage = "verification";
    onVerifying();
    return await api.register({
      name,
      challenge_id: result.value.challenge_id,
      credential: z.json().parse(json),
    });
  } catch {
    return {
      kind: "failed",
      error: {
        kind: "contract",
        message:
          stage === "verification"
            ? "Passkey enrollment could not be confirmed. Refresh your passkeys before trying again."
            : "Passkey enrollment was cancelled or unsupported. Your account is unchanged.",
      },
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
export async function authenticatePasskey(
  api: Api,
  {
    signal,
    onVerifying = () => {},
  }: { signal?: AbortSignal; onVerifying?: () => void } = {},
): Promise<Result<User>> {
  const cancelled = {
    kind: "failed",
    error: {
      kind: "contract",
      message: "Passkey sign-in was cancelled. Try again or use an email link.",
    },
  } as const;
  const result = await api.authenticationOptions();
  if (signal?.aborted) return cancelled;
  if (result.kind === "failed") return result;
  const cancel = () => WebAuthnAbortService.cancelCeremony();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const options = authentication.parse(result.value.public_key);
    const credential = await startAuthentication({
      optionsJSON: options,
    });
    const json: unknown = JSON.parse(JSON.stringify(credential));
    if (signal?.aborted) return cancelled;
    onVerifying();
    return await api.authenticate({
      challenge_id: result.value.challenge_id,
      credential: z.json().parse(json),
    });
  } catch {
    return {
      kind: "failed",
      error: {
        kind: "contract",
        message:
          "Passkey sign-in was cancelled or unsupported. Try a magic link.",
      },
    };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
