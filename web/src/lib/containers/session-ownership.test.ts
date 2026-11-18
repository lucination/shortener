import { it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import AppContainer from "./AppContainer.svelte";
import AdminContainer from "../../../../admin/src/AdminContainer.svelte";
import { createApi } from "../adapters/api";
vi.mock("../adapters/passkeys", () => ({
  authenticatePasskey: async () => ({ kind: "ok", value: user }),
  enrollPasskey: vi.fn(),
}));
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
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status });
for (const flow of ["admin", "logout", "global"] as const)
  for (const target of ["same page", "navigation", "replacement"] as const)
    for (const status of [200, 503])
      it(`${flow} held ${status} after ${target} respects session ownership`, async () => {
        let release!: (r: Response) => void;
        const held = new Promise<Response>((r) => (release = r));
        let calls = 0;
        const path =
          flow === "admin"
            ? "/_/api/logout"
            : flow === "logout"
              ? "/api/auth/logout"
              : "/api/account/sign-out-everywhere";
        const fetcher = vi.fn<typeof fetch>(async (input) => {
          const url = String(input);
          if (url === path && ++calls === 1) return held;
          if (url.endsWith("/logout") || url.endsWith("/login"))
            return json({ message: "done" });
          if (url === "/api/me") return json(user);
          if (url.endsWith("/usage"))
            return json({ users: 1, links: 0, redirects: 0, raw_events: 0 });
          return json({ items: [], total: 0 });
        });
        vi.stubGlobal("fetch", fetcher);
        const v =
          flow === "admin"
            ? render(AdminContainer)
            : render(AppContainer, { api: createApi(fetcher) });
        const click = async (name: string) =>
          fireEvent.click(v.getByRole("button", { name }));
        await waitFor(() =>
          expect(
            v.getByRole("button", {
              name: flow === "admin" ? "Usage" : "Account",
            }),
          ).toBeTruthy(),
        );
        if (flow === "global") {
          await click("Account");
          await waitFor(() =>
            expect(v.getByText("Raw click data")).toBeTruthy(),
          );
          await click("Sign out everywhere");
          await click("Confirm");
        } else await click("Sign out");
        await waitFor(() => expect(calls).toBe(1));
        if (target !== "same page") {
          await click(
            flow === "admin"
              ? "Usage"
              : flow === "global"
                ? "Links"
                : "Account",
          );
          if (flow === "admin") {
            await waitFor(() =>
              expect(
                v.container.querySelectorAll(".metric-grid > div"),
              ).toHaveLength(4),
            );
          } else {
            await waitFor(() =>
              expect(
                v.getByText(
                  flow === "global"
                    ? "Create your first short link"
                    : "Raw click data",
                ),
              ).toBeTruthy(),
            );
          }
        }
        if (target === "replacement") {
          await click("Sign out");
          if (flow === "admin") {
            await waitFor(() =>
              expect(v.getByLabelText("Admin token")).toBeTruthy(),
            );
            await fireEvent.input(v.getByLabelText("Admin token"), {
              target: { value: "test-only" },
            });
            await click("Sign in");
          } else {
            await waitFor(() =>
              expect(v.getByText("Send sign-in link")).toBeTruthy(),
            );
            await click("Sign in with passkey");
          }
          await waitFor(() =>
            expect(
              v.getByRole("button", {
                name: flow === "admin" ? "Usage" : "Account",
              }),
            ).toBeTruthy(),
          );
        }
        release(
          status === 200
            ? json({ message: "done" })
            : json({ code: "server", message: "OLD FAILURE" }, status),
        );
        await new Promise((r) => setTimeout(r, 40));
        const signedOut = status === 200 && target !== "replacement";
        expect(
          v.queryByRole("button", {
            name: flow === "admin" ? "Usage" : "Account",
          }) === null,
        ).toBe(signedOut);
        if (signedOut)
          expect(
            v.getByRole("button", {
              name: flow === "admin" ? "Sign in" : "Send sign-in link",
            }),
          ).toBeTruthy();
        expect(v.queryAllByText("OLD FAILURE").length > 0).toBe(
          status === 503 && target === "same page",
        );
        vi.unstubAllGlobals();
      });
