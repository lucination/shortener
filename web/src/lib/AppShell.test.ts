import { it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import AppShell from "./AppShell.svelte";
const children = createRawSnippet(() => ({
  render: () => "<div>Content</div>",
}));
it("login shell exposes neither authenticated navigation nor admin or theme controls", () => {
  const v = render(AppShell, {
    children,
    section: "links",
    authenticated: false,
  });
  for (const label of ["Links", "Account", "Admin", "Sign out", "Theme"])
    expect(v.queryByText(label)).toBeNull();
  expect(v.container.textContent).not.toContain("Small links");
  expect(v.container.textContent).not.toContain("The Monospace Web");
});
it("authenticated user shell exposes only user navigation", () => {
  const v = render(AppShell, {
    children,
    section: "links",
    authenticated: true,
  });
  expect(v.getByText("Account")).toBeTruthy();
  expect(v.getByText("Sign out")).toBeTruthy();
  expect(v.queryByText("Admin")).toBeNull();
});
