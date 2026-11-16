it("shows named keys with controlled enrollment and rename inputs", async () => {
  const onname = vi.fn(),
    onrename = vi.fn();
  const v = render(PasskeySection, {
    state: { kind: "idle" },
    name: "Laptop",
    keys: { kind: "ready", value: [{ id: 7, name: "Desk key" }] },
    onname,
    onrename,
  });
  expect(v.getByLabelText("New passkey name")).toBeTruthy();
  await fireEvent.input(v.getByLabelText("New passkey name"), {
    target: { value: "Phone" },
  });
  expect(onname).toHaveBeenCalledWith("Phone");
  expect(v.getByDisplayValue("Desk key")).toBeTruthy();
  await fireEvent.click(v.getByRole("button", { name: /^Rename$/ }));
  expect(onrename).toHaveBeenCalledWith(7);
});
import { it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import AccountPanel from "./AccountPanel.svelte";
import PasskeySection from "./PasskeySection.svelte";
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

it("does not impose a UTF-16 bound on valid 80-codepoint names", () => {
  const v = render(PasskeySection, {
    state: { kind: "idle" },
    keys: { kind: "ready", value: [{ id: 1, name: "🔑".repeat(80) }] },
  });
  for (const input of v.container.querySelectorAll("input"))
    expect(input.maxLength < 0 || input.maxLength >= 160).toBe(true);
});
