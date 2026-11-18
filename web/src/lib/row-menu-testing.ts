// Test-only helper: activate an item in the n-th Dashboard row's More actions menu.
import { fireEvent, within } from "@testing-library/svelte";
import { tick } from "svelte";

export const rowMenuTriggers = (root: HTMLElement = document.body) =>
  within(root).getAllByRole("button", { name: /^More actions for / });

export const chooseRowAction = async (
  row: number,
  item: string | RegExp,
  root: HTMLElement = document.body,
): Promise<void> => {
  await fireEvent.click(rowMenuTriggers(root)[row]);
  await tick();
  await fireEvent.click(
    within(within(document.body).getByRole("menu")).getByRole("menuitem", {
      name: item,
    }),
  );
};
