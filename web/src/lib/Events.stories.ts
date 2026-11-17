import Analytics from "./Analytics.svelte";
import { simulatedEventRows } from "./fixtures";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Analytics/Events",
  component: Analytics,
  args: {
    range: { from: "2026-11-08", to: "2026-11-14" },
    view: {
      kind: "events",
      label: "Field notes",
      state: { kind: "ready", value: simulatedEventRows },
    },
  },
} satisfies Meta<typeof Analytics>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Events: Story = {
  args: {
    view: {
      kind: "events",
      label: "Field notes",
      state: { kind: "ready", value: simulatedEventRows },
    },
  },
};
export const EventsEmpty: Story = {
  args: {
    view: {
      kind: "events",
      label: "Field notes",
      state: { kind: "ready", value: [] },
    },
  },
};
