import { it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import LinkEditor from "./LinkEditor.svelte";
it("emits a draft replacement and submit without performing network effects", async () => {
  const onchange = vi.fn();
  const onsubmit = vi.fn();
  const draft = {
    destination: "",
    alias: "",
    title: "",
    description: "",
    password: "",
    expiresAt: "",
    clickLimit: "",
    retentionDays: "",
    interstitial: false,
    queryMode: "discard" as const,
  };
  const view = render(LinkEditor, {
    mode: { kind: "create" },
    draft,
    outcome: { kind: "idle" },
    onchange,
    onsubmit,
  });
  await fireEvent.input(view.getByLabelText("Destination URL"), {
    target: { value: "https://example.org" },
  });
  expect(onchange).toHaveBeenCalledWith({
    ...draft,
    destination: "https://example.org",
  });
  await fireEvent.submit(view.getByTestId("link-editor"));
  expect(onsubmit).toHaveBeenCalledOnce();
});
