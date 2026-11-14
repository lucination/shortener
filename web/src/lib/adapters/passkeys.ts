import { z } from "zod";
import {
  startRegistration,
  startAuthentication,
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
  publicKey: z.object({
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
    attestation: z
      .enum(["none", "indirect", "direct", "enterprise"])
      .optional(),
    authenticatorSelection: z
      .object({
        authenticatorAttachment: z
          .enum(["platform", "cross-platform"])
          .optional(),
        residentKey: z
          .enum(["discouraged", "preferred", "required"])
          .optional(),
        requireResidentKey: z.boolean().optional(),
        userVerification: z
          .enum(["required", "preferred", "discouraged"])
          .optional(),
      })
      .optional(),
  }),
});
const authentication = z.object({
  publicKey: z.object({
    challenge: z.string(),
    rpId: z.string().optional(),
    timeout: z.number().optional(),
    allowCredentials: z.array(descriptor).optional(),
    userVerification: z
      .enum(["required", "preferred", "discouraged"])
      .optional(),
  }),
});
export async function enrollPasskey(api: Api): Promise<Result<Message>> {
  const result = await api.registrationOptions();
  if (result.kind === "failed") return result;
  try {
    const options = creation.parse(result.value.public_key);
    const credential = await startRegistration({
      optionsJSON: options.publicKey,
    });
    const json: unknown = JSON.parse(JSON.stringify(credential));
    return await api.register({
      challenge_id: result.value.challenge_id,
      credential: z.json().parse(json),
    });
  } catch {
    return {
      kind: "failed",
      error: {
        kind: "contract",
        message:
          "Passkey enrollment was cancelled or unsupported. Your account is unchanged.",
      },
    };
  }
}
export async function authenticatePasskey(
  api: Api,
  email: string,
): Promise<Result<User>> {
  const result = await api.authenticationOptions({ email });
  if (result.kind === "failed") return result;
  try {
    const options = authentication.parse(result.value.public_key);
    const credential = await startAuthentication({
      optionsJSON: options.publicKey,
    });
    const json: unknown = JSON.parse(JSON.stringify(credential));
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
  }
}
