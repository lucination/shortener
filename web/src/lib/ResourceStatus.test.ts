import { it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import ResourceStatus from "./ResourceStatus.svelte";
it("shows a meaningful network error title and an inline recovery action", async () => {
  const onretry = vi.fn();
  const v = render(ResourceStatus, {
    state: {
      kind: "error",
      reason: "network",
      message: "Your input is preserved.",
    },
    onretry,
  });
  expect(v.getByText("Connection unavailable")).toBeTruthy();
  expect(v.getByText("Your input is preserved.")).toBeTruthy();
  await fireEvent.click(v.getByText("Retry"));
  expect(onretry).toHaveBeenCalledOnce();
});
it("distinguishes validation feedback from authentication failure", () => {
  const v = render(ResourceStatus, {
    state: {
      kind: "error",
      reason: "validation",
      message: "Use a positive whole number.",
    },
  });
  expect(v.getByText("Check your input")).toBeTruthy();
});
