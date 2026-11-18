import AnalyticsStory from "./story-harness/AnalyticsStory.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Workspace/Statistics",
  component: AnalyticsStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AnalyticsStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
export const Empty: Story = { args: { scenario: "empty" } };
export const Loading: Story = { args: { scenario: "pending" } };
export const Failed: Story = { args: { scenario: "error" } };
export const Events: Story = { args: { initialTab: "events" } };
export const EventsEmpty: Story = {
  args: { scenario: "empty", initialTab: "events" },
};
