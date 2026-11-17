import { it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/svelte";
import AppContainer from "./AppContainer.svelte";
import { createApi } from "../adapters/api";
import { simulatedLinks, simulatedUsers } from "../fixtures";

function mount() {
  const fetcher = vi.fn<typeof fetch>(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input) === "/api/me"
            ? simulatedUsers[0]
            : { items: simulatedLinks, total: simulatedLinks.length },
        ),
      ),
  );
  return { v: render(AppContainer, { api: createApi(fetcher) }), fetcher };
}

for (const count of [1, 2])
  for (const [title, verb, valueForm] of [
    ["Enable selected links", "Enable", false],
    ["Disable selected links", "Disable", false],
    ["Delete selected links", "Delete", false],
    ["Set expiration", "Set expiration", true],
    ["Set retention", "Set retention", true],
  ] as const)
    it(`renders sentence-case ${verb} for ${count} selected links`, async () => {
      const { v, fetcher } = mount();
      await waitFor(() =>
        expect(v.getByTitle("Select Field notes")).toBeTruthy(),
      );
      for (const link of simulatedLinks.slice(0, count))
        await fireEvent.click(v.getByTitle(`Select ${link.title}`));
      await fireEvent.click(v.getByTitle(title));
      const noun = count === 1 ? "link" : "links";
      expect(
        v.getByRole("heading", {
          name: valueForm
            ? `${verb} for ${count} ${noun}`
            : `${verb} ${count} ${noun}?`,
        }),
      ).toBeTruthy();
      expect(v.getByRole("button", { name: "Confirm" })).toBeTruthy();
      if (!valueForm && verb !== "Delete")
        expect(
          v.getByText(`Apply this change to the selected ${noun}.`),
        ).toBeTruthy();
      if (valueForm)
        expect(
          v.getByLabelText(
            verb === "Set expiration" ? "Expiration" : "Retention days",
          ),
        ).toBeTruthy();
      await fireEvent.click(v.getByRole("button", { name: "Cancel" }));
      expect(
        fetcher.mock.calls.every(
          ([, init]) => !init?.method || init.method === "GET",
        ),
      ).toBe(true);
      expect(v.getByText(`${count} selected`)).toBeTruthy();
    });

it("selects and clears only filtered visible rows while preserving hidden selections", async () => {
  const { v } = mount();
  await waitFor(() =>
    expect(v.getByTitle("Select all visible links")).toBeTruthy(),
  );
  const all = () =>
    v.getByTitle("Select all visible links") as HTMLInputElement;
  const search = v.getByPlaceholderText("Search links, destinations, aliases…");
  await fireEvent.click(v.getByTitle("Select Autumn archive"));
  expect(all().indeterminate).toBe(true);
  await fireEvent.input(search, { target: { value: "Field notes" } });
  expect(all().checked).toBe(false);
  await fireEvent.click(all());
  expect(v.getByText("2 selected")).toBeTruthy();
  expect(all().checked).toBe(true);
  await fireEvent.click(all());
  expect(v.getByText("1 selected")).toBeTruthy();
  await fireEvent.input(search, { target: { value: "" } });
  expect(
    (v.getByTitle("Select Autumn archive") as HTMLInputElement).checked,
  ).toBe(true);
  expect(all().indeterminate).toBe(true);
  await fireEvent.click(all());
  expect(v.getByText("3 selected")).toBeTruthy();
  expect(all().checked).toBe(true);
  await fireEvent.click(v.getByTitle("Select Field notes"));
  expect(all().indeterminate).toBe(true);
  await fireEvent.click(all());
  await fireEvent.click(all());
  expect(v.queryByText(/selected$/)).toBeNull();
  expect(all().checked).toBe(false);
  expect(all().indeterminate).toBe(false);
});
