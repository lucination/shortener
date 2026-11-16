import { it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import AccountPanel from "./AccountPanel.svelte";

it("labels the administrator-managed email box", () => {
  const view = render(AccountPanel, {
    email: "reader@example.org",
    retention: "90",
    outcome: { kind: "idle" },
  });
  const heading = view.getByRole("heading", {
    name: "Email address",
    level: 2,
  });
  const box = heading.parentElement;
  expect(box?.classList.contains("box-frame")).toBe(true);
  expect(box?.textContent).toContain("reader@example.org");
  expect(box?.textContent).toContain(
    "Your email address is managed by your administrator.",
  );
  expect(heading.nextElementSibling?.textContent).toBe("reader@example.org");
});
