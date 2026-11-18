import type { Meta, StoryObj } from "@storybook/sveltekit";
import Toast from "./Toast.svelte";
const meta = {
  title: "Feedback/Toast",
  component: Toast,
} satisfies Meta<typeof Toast>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Success: Story = {
  args: { notice: { kind: "success", message: "Short address copied." } },
};
export const Failure: Story = {
  args: {
    notice: {
      kind: "error",
      message: "Clipboard unavailable. Select and copy the short address.",
    },
  },
};
