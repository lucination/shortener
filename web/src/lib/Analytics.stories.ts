import Analytics from "./Analytics.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
import { simulatedStatsView, simulatedEventRows } from "./fixtures";
const meta = {
  title: "Analytics/Stats and events",
  component: Analytics,
  args: {
    range: { from: "2026-11-08", to: "2026-11-14" },
    view: {
      kind: "stats",
      label: "Field notes",
      state: { kind: "ready", value: simulatedStatsView },
    },
  },
} satisfies Meta<typeof Analytics>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
export const Empty: Story = {
  args: {
    view: {
      kind: "stats",
      label: "New link",
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
  },
};
export const Pending: Story = {
  args: {
    view: { kind: "stats", label: "Field notes", state: { kind: "pending" } },
  },
};
export const Failed: Story = {
  args: {
    view: {
      kind: "stats",
      label: "Field notes",
      state: {
        kind: "error",
        message: "Statistics are unavailable. Retry without changing the link.",
      },
    },
  },
};
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
