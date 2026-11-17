import { emptyDraft } from "./view-models";
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

it("shows the existing short address as immutable text, not a disabled edit control", () => {
  const v = render(LinkEditor, {
    mode: { kind: "edit", id: 1 },
    draft: { ...emptyDraft, alias: "Keep-A" },
    outcome: { kind: "idle" },
  });
  expect(v.queryByLabelText("Custom alias")).toBeNull();
  expect(v.getByText("Short address", { exact: true })).toBeTruthy();
  expect(v.getByText("Keep-A", { exact: true })).toBeTruthy();
  expect(v.container.querySelector('input[value="Keep-A"]')).toBeNull();
  expect(v.getByText(/Archive this link and create a new one/)).toBeTruthy();
});
it("continues accepting a custom alias when creating a link", async () => {
  const onchange = vi.fn();
  const v = render(LinkEditor, {
    mode: { kind: "create" },
    draft: emptyDraft,
    outcome: { kind: "idle" },
    onchange,
  });
  await fireEvent.input(v.getByLabelText("Custom alias"), {
    target: { value: "New-A" },
  });
  expect(onchange).toHaveBeenCalledWith({ ...emptyDraft, alias: "New-A" });
});
