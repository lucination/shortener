import ManagementStory from "./ManagementStory.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Workspace/Creator pages",
  component: ManagementStory,
  args: { kind: "statistics" },
} satisfies Meta<typeof ManagementStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Statistics: Story = {};
export const Loading: Story = { args: { state: { kind: "pending" } } };
export const Empty: Story = {
  args: {
    state: {
      kind: "ready",
      value: {
        human: 0,
        bot: 0,
        preview: 0,
        days: [],
        countries: [],
        devices: [],
        referrers: [],
      },
    },
  },
};
export const Failed: Story = {
  args: {
    state: { kind: "error", message: "Statistics could not be loaded. Retry." },
  },
};
export const Edit: Story = { args: { kind: "edit" } };
export const EditFailure: Story = {
  args: {
    kind: "edit",
    outcome: {
      kind: "error",
      message: "The link could not be saved. Your input is unchanged.",
    },
  },
};
