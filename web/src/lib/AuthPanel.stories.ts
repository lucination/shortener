import AuthPanel from "./AuthPanel.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Access/Sign in",
  component: AuthPanel,
  args: {
    mode: { kind: "magic", email: "reader@example.org" },
    outcome: { kind: "idle" },
  },
} satisfies Meta<typeof AuthPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MagicLink: Story = {};
export const Sending: Story = { args: { state: { kind: "sending" } } };
export const Sent: Story = {
  args: {
    state: { kind: "sent" },
    outcome: {
      kind: "success",
      message:
        "If this email belongs to an account, a sign-in link is on its way.",
    },
  },
};
export const Failed: Story = {
  args: {
    state: {
      kind: "email-error",
      message: "Unable to request a sign-in link. Try again.",
    },
    outcome: {
      kind: "error",
      message: "Unable to request a sign-in link. Try again.",
    },
  },
};
export const AdminToken: Story = {
  args: { mode: { kind: "admin", token: "" } },
};
export const AdminRejected: Story = {
  args: {
    mode: { kind: "admin", token: "" },
    outcome: { kind: "error", message: "Invalid administrator token." },
  },
};
