import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import SignInHarness from "./SignInHarness.svelte";
import SignInPage from "../SignInPage.svelte";

describe("Precision sign-in page", () => {
  it("presents one user sign-in form and delegates entered email without auth effects", async () => {
    const onchange = vi.fn();
    const onsubmit = vi.fn();
    const v = render(SignInPage, {
      appName: "Shortener",
      email: "",
      state: { kind: "idle" },
      onchange,
      onsubmit,
    });
    expect(v.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Sign in",
    ]);
    expect(v.getAllByText("Shortener")).toHaveLength(1);
    await fireEvent.input(v.getByLabelText("Email"), {
      target: { value: "reader@example.org" },
    });
    expect(onchange).toHaveBeenCalledWith("reader@example.org");
    await fireEvent.submit(v.container.querySelector("form")!);
    expect(onsubmit).toHaveBeenCalledTimes(1);
    expect(v.getByText("Sign in with passkey")).toBeTruthy();
    expect(v.container.textContent).not.toMatch(
      /admin|workspace|password|shorter way|signup/i,
    );
  });
});

it("retains submitted email through pending, sent, resend and passkey cancellation", async () => {
  const v = render(SignInHarness);
  await fireEvent.input(v.getByLabelText("Email"), {
    target: { value: "reader@example.org" },
  });
  await fireEvent.submit(v.container.querySelector("form")!);
  expect((v.getByText("Sending link…") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(
    (v.getByText("Sign in with passkey") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((v.getByLabelText("Email") as HTMLInputElement).value).toBe(
    "reader@example.org",
  );
  await vi.waitFor(() =>
    expect(v.getByText(/If this email belongs/)).toBeTruthy(),
  );
  await fireEvent.click(v.getByText("Send another link"));
  expect(v.queryByText(/If this email belongs/)).toBeNull();
  await vi.waitFor(() =>
    expect(v.getByText(/If this email belongs/)).toBeTruthy(),
  );
  await fireEvent.click(v.getByText("Sign in with passkey"));
  expect(v.getByText("Waiting for passkey…")).toBeTruthy();
  await fireEvent.click(v.getByText("Cancel"));
  expect(v.getByText(/Passkey sign-in was cancelled/)).toBeTruthy();
  expect((v.getByLabelText("Email") as HTMLInputElement).value).toBe(
    "reader@example.org",
  );
});

it("starts a passkey independently when the email is empty", async () => {
  const onpasskey = vi.fn();
  const v = render(SignInPage, {
    appName: "Fieldlinks",
    email: "",
    state: { kind: "idle" },
    onpasskey,
  });
  await fireEvent.click(v.getByText("Sign in with passkey"));
  expect(onpasskey).toHaveBeenCalledTimes(1);
});
it("renders an HTML-like app name only as text", () => {
  const appName = '<img src=x onerror="alert(1)">';
  const v = render(SignInPage, { appName, email: "", state: { kind: "idle" } });
  expect(v.getByText(appName)).toBeTruthy();
  expect(v.container.querySelector("img")).toBeNull();
});
