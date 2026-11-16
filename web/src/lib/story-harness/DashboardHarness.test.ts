import { it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import DashboardHarness from "./DashboardHarness.svelte";
it("previews the real complete editor as a dialog and saves its controlled draft", async () => {
  const v = render(DashboardHarness);
  await fireEvent.click(v.getByText("+ Create link"));
  expect(v.getByRole("dialog").contains(v.getByLabelText("Click limit"))).toBe(
    true,
  );
  await fireEvent.input(v.getByLabelText("Destination URL"), {
    target: { value: "https://example.test/notes" },
  });
  await fireEvent.input(v.getByLabelText("Title"), {
    target: { value: "Story-created link" },
  });
  await fireEvent.submit(v.getByTestId("link-editor"));
  expect(v.queryByRole("dialog")).toBeNull();
  expect(v.getByText("Story-created link")).toBeTruthy();
});
