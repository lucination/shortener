import { it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import AccountPanel from "./AccountPanel.svelte";
it("keeps enrollment feedback inside the controlled passkey section, apart from retention and sessions", async () => {
  const onenroll = vi.fn();
  const view = render(AccountPanel, {
    email: "reader@example.org",
    retention: "90",
    outcome: { kind: "idle" },
    enrollment: { kind: "failed", message: "Enrollment cancelled." },
    onenroll,
  });
  const section = view.getByTestId("passkey-section");
  expect(section.textContent).toContain("Enrollment cancelled.");
  expect(section.textContent).toContain("Add passkey");
  expect(
    view.getByText("Raw click data").parentElement?.textContent,
  ).not.toContain("Enrollment cancelled.");
  expect(view.getByText("Sessions").parentElement?.textContent).not.toContain(
    "Enrollment cancelled.",
  );
  await fireEvent.click(view.getByText("Add passkey"));
  expect(onenroll).toHaveBeenCalledOnce();
});
