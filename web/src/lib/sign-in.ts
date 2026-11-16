/** User authentication presentation lifecycle, independent of API outcomes. */
export type SignInState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "email-error"; message: string }
  | { kind: "passkey-pending" }
  | { kind: "passkey-verifying" }
  | { kind: "passkey-cancelling" }
  | { kind: "passkey-cancelled" }
  | { kind: "passkey-error"; message: string };
