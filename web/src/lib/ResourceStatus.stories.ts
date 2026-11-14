import type { Meta, StoryObj } from "@storybook/sveltekit";
import ResourceStatus from "./ResourceStatus.svelte";
const meta = {
  title: "Feedback/Inline status",
  component: ResourceStatus,
  args: { onretry: () => {} },
} satisfies Meta<typeof ResourceStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Network: Story = {
  args: {
    state: {
      kind: "error",
      reason: "network",
      message: "The server could not be reached. Your input is preserved.",
    },
  },
};
export const Validation: Story = {
  args: {
    state: {
      kind: "error",
      reason: "validation",
      message: "Retention must be a positive whole number.",
    },
    onretry: undefined,
  },
};
export const Authentication: Story = {
  args: {
    state: {
      kind: "error",
      reason: "authentication",
      message: "Your session has expired. Sign in again.",
    },
  },
};
export const Pending: Story = { args: { state: { kind: "pending" } } };
