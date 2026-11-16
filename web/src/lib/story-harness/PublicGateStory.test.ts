import { it, expect } from "vitest";
import { render } from "@testing-library/svelte";
import meta from "../PublicPage.stories";
it("previews the native password document rather than a separate SPA recreation", () => {
  const v = render(meta.component, {
    page: { kind: "password", password: "" },
    outcome: { kind: "idle" },
  });
  const frame = v.container.querySelector("iframe");
  expect(frame).not.toBeNull();
  expect(frame?.srcdoc).toContain("<h1>Password required</h1>");
  expect(frame?.srcdoc).toContain("native-public");
  expect(frame?.srcdoc).toContain("method=post");
});
