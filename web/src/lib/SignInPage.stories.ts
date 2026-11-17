import type { Meta, StoryObj } from "@storybook/sveltekit";
import SignInHarness from "./story-harness/SignInHarness.svelte";
const meta = {
  title: "Access/Sign in",
  component: SignInHarness,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SignInHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SignIn: Story = {};
export const Sending: Story = {
  args: {
    initialEmail: "reader@example.org",
    initialState: { kind: "sending" },
  },
};
export const Sent: Story = {
  args: { initialEmail: "reader@example.org", initialState: { kind: "sent" } },
};
export const EmailError: Story = {
  args: {
    initialEmail: "reader@example.org",
    initialState: {
      kind: "email-error",
      message: "Unable to request a sign-in link. Try again.",
    },
  },
};
export const PasskeyPending: Story = {
  args: {
    initialEmail: "reader@example.org",
    initialState: { kind: "passkey-pending" },
  },
};
export const PasskeyCancelled: Story = {
  args: {
    initialEmail: "reader@example.org",
    initialState: { kind: "passkey-cancelled" },
  },
};
export const PasskeyError: Story = {
  args: {
    initialEmail: "reader@example.org",
    initialState: {
      kind: "passkey-error",
      message:
        "Unable to sign in with a passkey. Try again or use an email link.",
    },
    passkeyResult: "error",
  },
};
export const CustomName: Story = { args: { appName: "Fieldlinks" } };
