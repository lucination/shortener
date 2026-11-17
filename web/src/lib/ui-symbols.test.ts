import { it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import Dashboard from "./Dashboard.svelte";
import AdminPanel from "./AdminPanel.svelte";
import ManagementFrame from "./ManagementFrame.svelte";
import { simulatedLinkRows, simulatedUserRows } from "./fixtures";

it("uses a real Plus icon for link creation without changing its callback", async () => {
  const oncreate = vi.fn();
  const v = render(Dashboard, {
    state: { kind: "ready", value: simulatedLinkRows },
    oncreate,
  });
  const button = v.getByRole("button", { name: "Create link" });
  expect(button.querySelector("svg.lucide-plus")).toBeTruthy();
  expect(button.textContent?.trim()).toBe("Create link");
  await fireEvent.click(button);
  expect(oncreate).toHaveBeenCalledOnce();
});
it("uses a real Plus icon for administrator creation without changing its callback", async () => {
  const oncreate = vi.fn();
  const v = render(AdminPanel, {
    view: { kind: "users", state: { kind: "ready", value: simulatedUserRows } },
    outcome: { kind: "idle" },
    oncreate,
  });
  const button = v.getByRole("button", { name: "Add user" });
  expect(button.querySelector("svg.lucide-plus")).toBeTruthy();
  expect(button.textContent?.trim()).toBe("Add user");
  await fireEvent.click(button);
  expect(oncreate).toHaveBeenCalledOnce();
});
it("uses an ArrowLeft icon for the focused management back link", () => {
  const v = render(ManagementFrame, {
    identity: {
      label: "Notes",
      address: "example.com/notes",
      destination: "https://example.org",
    },
    children: createRawSnippet(() => ({ render: () => "<p>Content</p>" })),
  });
  const link = v.getByRole("link", { name: "Back to links" });
  expect(link.querySelector("svg.lucide-arrow-left")).toBeTruthy();
  expect(link.textContent?.trim()).toBe("Back to links");
  expect(link.getAttribute("href")).toBe("/");
});
