import type { Meta, StoryObj } from "@storybook/sveltekit";
import DesignCompare from "./DesignCompare.svelte";
const meta = {
  title: "Design language",
  component: DesignCompare,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof DesignCompare>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Compare: Story = {};
export const Precision: Story = { args: { direction: "precision" } };
export const Paper: Story = { args: { direction: "paper" } };
export const Studio: Story = { args: { direction: "studio" } };
