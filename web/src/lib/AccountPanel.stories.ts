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
export const PasskeyPending: Story = { args: { outcome: { kind: "pending" } } };
export const PasskeyEnrolled: Story = {
  args: {
    outcome: { kind: "success", message: "Passkey added to your account." },
  },
};
export const PasskeyFailed: Story = {
  args: {
    outcome: {
      kind: "error",
      message: "Passkey enrollment was cancelled. Your account is unchanged.",
    },
  },
};
