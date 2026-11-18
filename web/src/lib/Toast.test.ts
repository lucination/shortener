import { it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import Toast from "./Toast.svelte";

it("keeps one mounted polite live region and renders only the current notice", async () => {
  const v = render(Toast, { notice: { kind: "idle" } });
  const region = v.getByRole("status");
  expect(region.getAttribute("aria-live")).toBe("polite");
  expect(region.textContent?.trim()).toBe("");
  await v.rerender({ notice: { kind: "success", message: "Link updated." } });
  expect(v.getByRole("status")).toBe(region);
  expect(v.getByText("Link updated.").classList.contains("toast-error")).toBe(
    false,
  );
  await v.rerender({ notice: { kind: "error", message: "Denied." } });
  expect(v.getByText("Denied.").classList.contains("toast-error")).toBe(true);
  expect(v.container.querySelectorAll(".toast")).toHaveLength(1);
});
