import { it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/svelte";
import AdminContainer from "../../../../admin/src/AdminContainer.svelte";
import { simulatedUsers } from "../fixtures";
afterEach(() => vi.unstubAllGlobals());

for (const [button, title, index] of [
  ["Suspend", "Suspend user #1?", 0],
  ["Reactivate", "Reactivate user #2?", 1],
  ["Sign out everywhere", "Sign out user #1?", 0],
  ["Soft delete", "Soft delete user #1?", 0],
  ["quota", "Change link quota", 0],
  ["retention", "Change retention", 0],
] as const)
  it(`uses sentence-case administrator ${button} confirmation copy`, async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            items: simulatedUsers,
            total: simulatedUsers.length,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const v = render(AdminContainer);
    await waitFor(() =>
      expect(v.getByText(simulatedUsers[index].email)).toBeTruthy(),
    );
    const row = v.getByText(simulatedUsers[index].email).closest("tr")!;
    const target =
      button === "quota"
        ? row.querySelectorAll("button")[0]
        : button === "retention"
          ? row.querySelectorAll("button")[1]
          : within(row).getByRole("button", { name: button });
    await fireEvent.click(target);
    expect(v.getByRole("heading", { name: title })).toBeTruthy();
    expect(v.getByRole("button", { name: "Confirm" })).toBeTruthy();
    await fireEvent.click(v.getByRole("button", { name: "Cancel" }));
    expect(
      fetcher.mock.calls.every(
        ([, init]) => !init?.method || init.method === "GET",
      ),
    ).toBe(true);
  });
