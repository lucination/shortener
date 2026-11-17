import AuthPanel from "./AuthPanel.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Administration/Sign in",
  component: AuthPanel,
  args: { mode: { kind: "admin", token: "" }, outcome: { kind: "idle" } },
} satisfies Meta<typeof AuthPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Token: Story = {};
export const Rejected: Story = {
  args: { outcome: { kind: "error", message: "Invalid administrator token." } },
};
