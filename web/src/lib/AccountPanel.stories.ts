import AccountPanel from "./AccountPanel.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Access/Account",
  component: AccountPanel,
  args: {
    email: "reader@example.org",
    retention: "90",
    outcome: { kind: "idle" },
  },
} satisfies Meta<typeof AccountPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Account: Story = {};
export const PasskeyPending: Story = {
  args: { enrollment: { kind: "enrolling" } },
};
export const PasskeyEnrolled: Story = {
  args: {
    enrollment: {
      kind: "succeeded",
      message: "Passkey added to your account.",
    },
  },
};
export const PasskeyFailed: Story = {
  args: {
    enrollment: {
      kind: "failed",
      message: "Passkey enrollment was cancelled. Your account is unchanged.",
    },
  },
};
