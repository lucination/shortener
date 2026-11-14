import DashboardHarness from "./DashboardHarness.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Workbench/Interactive",
  component: DashboardHarness,
  parameters: {
    docs: {
      description: {
        component:
          "Isolated story-only interaction state. Uses generated DTO fixtures and controlled production components; no network adapter.",
      },
    },
  },
} satisfies Meta<typeof DashboardHarness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const TryTheComponents: Story = {};
