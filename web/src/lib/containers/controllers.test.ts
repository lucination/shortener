import { it, expect, vi, afterEach } from "vitest";
vi.mock("../adapters/passkeys", () => ({
  enrollPasskey: vi.fn(),
  authenticatePasskey: vi.fn(),
}));
import { enrollPasskey, authenticatePasskey } from "../adapters/passkeys";
import type { Api, Result } from "../adapters/api";
import { Generation } from "./generation";
import { ToastController } from "./toast.svelte";
import { SessionState } from "./session.svelte";
import { PageOutcome } from "./outcome.svelte";
import { AccessTokensController } from "./access-tokens.svelte";
import { PasskeysController } from "./passkeys.svelte";
import { AuthController } from "./auth.svelte";
import { CommandController, commandSuccess } from "./commands.svelte";
import { LinksController } from "./links.svelte";
import { importSummary } from "./import.svelte";
import { simulatedLinks } from "../fixtures";

afterEach(() => vi.useRealTimers());
const ok = <T>(value: T): Result<T> => ({ kind: "ok", value });
const held = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const fakeApi = (methods: Partial<Record<keyof Api, unknown>>) =>
  methods as unknown as Api;
const flush = () => new Promise((r) => setTimeout(r, 0));

it("generation advances notify listeners and fence older requests", () => {
  const generation = new Generation();
  const listener = vi.fn();
  const request = generation.current;
  const stop = generation.onAdvance(listener);
  expect(generation.advance()).toBe(request + 1);
  expect(generation.owns(request)).toBe(false);
  expect(listener).toHaveBeenCalledOnce();
  stop();
  generation.advance();
  expect(listener).toHaveBeenCalledOnce();
});

it("toast publishes only the newest attempt and dismisses after 3s/5s", () => {
  vi.useFakeTimers();
  const toast = new ToastController();
  const old = toast.begin();
  const current = toast.begin();
  toast.settle(old, "success", "stale");
  expect(toast.notice.kind).toBe("idle");
  toast.settle(current, "success", "Copied.");
  expect(toast.notice).toEqual({ kind: "success", message: "Copied." });
  vi.advanceTimersByTime(2999);
  expect(toast.notice.kind).toBe("success");
  vi.advanceTimersByTime(1);
  expect(toast.notice.kind).toBe("idle");
  toast.show("error", "Denied.");
  vi.advanceTimersByTime(4999);
  expect(toast.notice.kind).toBe("error");
  vi.advanceTimersByTime(1);
  expect(toast.notice.kind).toBe("idle");
  // A newer notice invalidates an in-flight attempt.
  const pending = toast.begin();
  toast.show("success", "Link updated.");
  toast.settle(pending, "error", "late");
  expect(toast.notice).toEqual({ kind: "success", message: "Link updated." });
  toast.clear();
  expect(toast.notice.kind).toBe("idle");
});

it("access-token secret is cleared by every generation advance and held issuance never reveals", async () => {
  const generation = new Generation();
  const issued = held<Result<unknown>>();
  const metadata = { id: 1 };
  const api = fakeApi({
    issueAccessToken: () => issued.promise,
    accessTokens: async () => ok({ items: [] }),
  });
  const tokens = new AccessTokensController({
    api,
    copy: async () => {},
    generation,
    active: () => true,
  });
  tokens.issued = { token: "secret", metadata } as never;
  generation.advance();
  expect(tokens.issued).toBeUndefined();
  const issuing = tokens.issue();
  generation.advance();
  issued.resolve(ok({ token: "late", metadata }));
  await issuing;
  expect(tokens.issued).toBeUndefined();
  tokens.tokens = { kind: "ready", value: [] };
  tokens.reset();
  expect(tokens.tokens.kind).toBe("pending");
});

it("passkey enrollment abandons only while preparing and stays busy until settled", async () => {
  const generation = new Generation();
  const session = new SessionState();
  session.authenticate();
  let onVerifying!: () => void;
  let signal!: AbortSignal;
  const settled = held<Result<unknown>>();
  vi.mocked(enrollPasskey).mockImplementation(async (_api, _name, opts) => {
    onVerifying = opts!.onVerifying!;
    signal = opts!.signal!;
    return settled.promise as never;
  });
  const passkeys = new PasskeysController({
    api: fakeApi({ passkeys: async () => ok({ items: [] }) }),
    generation,
    session,
    active: () => true,
    loginBusy: () => false,
  });
  passkeys.name = "Laptop";
  const enrolling = passkeys.enroll();
  expect(passkeys.enrollmentBusy).toBe(true);
  onVerifying();
  passkeys.abandon();
  expect(signal.aborted).toBe(false);
  generation.advance();
  settled.resolve(ok({ message: "added" }));
  await enrolling;
  expect(passkeys.enrollmentBusy).toBe(false);
  // The stale completion releases progress without claiming success.
  expect(passkeys.enrollment).toEqual({ kind: "idle" });

  const second = held<Result<unknown>>();
  vi.mocked(enrollPasskey).mockImplementation(async (_api, _name, opts) => {
    signal = opts!.signal!;
    return second.promise as never;
  });
  passkeys.name = "Phone";
  const again = passkeys.enroll();
  passkeys.abandon();
  expect(signal.aborted).toBe(true);
  expect(passkeys.enrollmentBusy).toBe(true);
  second.resolve({
    kind: "failed",
    error: { kind: "network", message: "aborted" },
  } as never);
  await again;
  expect(passkeys.enrollmentBusy).toBe(false);
});

it("passkey enrollment from a replaced session epoch publishes nothing", async () => {
  const generation = new Generation();
  const session = new SessionState();
  session.authenticate();
  const settled = held<Result<unknown>>();
  vi.mocked(enrollPasskey).mockImplementation(
    async () => settled.promise as never,
  );
  const passkeys = new PasskeysController({
    api: fakeApi({}),
    generation,
    session,
    active: () => true,
    loginBusy: () => false,
  });
  passkeys.name = "Laptop";
  const enrolling = passkeys.enroll();
  session.signOut();
  session.authenticate();
  settled.resolve(ok({ message: "added" }));
  await enrolling;
  expect(passkeys.enrollment).toEqual({ kind: "enrolling" });
});

it("passkey login cancellation holds the form until the attempt settles", async () => {
  const generation = new Generation();
  const outcome = new PageOutcome();
  const settled = held<Result<unknown>>();
  let signal!: AbortSignal;
  vi.mocked(authenticatePasskey).mockImplementation(async (_api, opts) => {
    signal = opts!.signal!;
    return settled.promise as never;
  });
  const signedIn = vi.fn(async () => {});
  const auth = new AuthController({
    api: fakeApi({}),
    generation,
    outcome,
    active: () => true,
    enrollmentBusy: () => false,
    signedIn,
  });
  const login = auth.passkeyLogin();
  expect(auth.loginBusy).toBe(true);
  auth.cancelPasskey();
  expect(signal.aborted).toBe(true);
  expect(auth.state.kind).toBe("passkey-cancelling");
  expect(outcome.pending).toBe(true);
  settled.resolve(ok({}));
  await login;
  expect(auth.state.kind).toBe("passkey-cancelled");
  expect(outcome.value.kind).toBe("idle");
  expect(signedIn).not.toHaveBeenCalled();
});

it("sign-out everywhere is honoured for the same epoch on another screen only", async () => {
  for (const replaced of [false, true]) {
    const generation = new Generation();
    const session = new SessionState();
    session.authenticate();
    const outcome = new PageOutcome();
    const response = held<Result<unknown>>();
    const signedOut = vi.fn();
    const completed = vi.fn(async () => {});
    const commands = new CommandController({
      api: fakeApi({ signoutEverywhere: () => response.promise }),
      generation,
      session,
      outcome,
      signedOut,
      completed,
    });
    commands.open({ kind: "signout" });
    const confirming = commands.confirm();
    generation.advance(); // navigated elsewhere
    if (replaced) session.authenticate();
    response.resolve(ok({ message: "done" }));
    await confirming;
    expect(signedOut).toHaveBeenCalledTimes(replaced ? 0 : 1);
    expect(completed).not.toHaveBeenCalled();
  }
});

it("successful link commands close and restore links with a specific notice", async () => {
  const generation = new Generation();
  const session = new SessionState();
  session.authenticate();
  const outcome = new PageOutcome();
  const completed = vi.fn(async () => {});
  const commands = new CommandController({
    api: fakeApi({ remove: async () => ok({ message: "deleted" }) }),
    generation,
    session,
    outcome,
    signedOut: () => {},
    completed,
  });
  commands.open({ kind: "delete-link", id: 3 });
  expect(commands.view?.title).toBe("Delete this link?");
  await commands.confirm();
  expect(commands.command).toBeUndefined();
  expect(completed).toHaveBeenCalledWith("Link deleted.");
  expect(
    commandSuccess({ kind: "bulk", ids: [1, 2], action: "disable", value: "" }),
  ).toBe("Disabled 2 links.");
});

it("links copy reports through the toast and ignores completions after a screen change", async () => {
  const generation = new Generation();
  const toast = new ToastController();
  const outcome = new PageOutcome();
  const writes: { resolve: () => void }[] = [];
  const links = new LinksController({
    api: fakeApi({
      links: async () =>
        ok({ items: simulatedLinks.slice(0, 1), total: 1 }) as never,
    }),
    copy: () => new Promise<void>((resolve) => writes.push({ resolve })),
    generation,
    outcome,
    toast,
    active: () => true,
  });
  expect(await links.load()).toBe("loaded");
  const id = simulatedLinks[0].id;
  const first = links.copyAddress(id);
  writes[0].resolve();
  await first;
  expect(toast.notice).toEqual({
    kind: "success",
    message: "Short address copied.",
  });
  const second = links.copyAddress(id);
  expect(toast.notice.kind).toBe("idle");
  generation.advance();
  writes[1].resolve();
  await second;
  await flush();
  expect(toast.notice.kind).toBe("idle");
  toast.clear();
});

it("import summary keeps only failed source rows and names physical rows", () => {
  const rows = [
    { kind: "valid", row: 2, destination: "https://example.org/a", alias: "a" },
    { kind: "valid", row: 4, destination: 'https://e.org/"q"', alias: "b" },
  ] as const;
  const summary = importSummary(rows, [
    { status: "created", index: 0, link: simulatedLinks[0] },
    {
      status: "failed",
      index: 1,
      error: { code: "conflict", message: "Reserved" },
    },
  ] as never);
  expect(summary.text).toBe('"https://e.org/""q""","b"');
  expect(summary.outcome).toEqual({
    kind: "error",
    message: "Row 2: created · Row 4: Reserved",
  });
});
