import AdminPanel from "./AdminPanel.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
import { simulatedUserRows } from "./fixtures";
const meta = {
  title: "Administration/Console",
  component: AdminPanel,
  args: {
    view: { kind: "users", state: { kind: "ready", value: simulatedUserRows } },
    outcome: { kind: "idle" },
  },
} satisfies Meta<typeof AdminPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Users: Story = {};
export const Pending: Story = {
  args: { view: { kind: "users", state: { kind: "pending" } } },
};
export const Failed: Story = {
  args: {
    view: {
      kind: "users",
      state: {
        kind: "error",
        message: "Administrator session expired. Sign in again.",
      },
    },
  },
};
export const Empty: Story = {
  args: { view: { kind: "users", state: { kind: "ready", value: [] } } },
};
export const Usage: Story = {
  args: {
    view: {
      kind: "usage",
      state: {
        kind: "ready",
        value: [
          { label: "Users", count: 12 },
          { label: "Links", count: 184 },
          { label: "Redirects", count: 14826 },
          { label: "Raw events", count: 19840 },
        ],
      },
    },
  },
};
export const Links: Story = {
  args: {
    view: {
      kind: "links",
      state: {
        kind: "ready",
        value: [
          {
            id: 1,
            label: "Field notes",
            destination: "https://example.org/notes",
            address: "example.com/notes",
            clicks: 1284,
            enabled: true,
          },
        ],
      },
    },
  },
};
export const Events: Story = {
  args: {
    view: {
      kind: "events",
      state: {
        kind: "ready",
        value: [
          {
            id: 1,
            at: "2026-11-14 14:02:18",
            link: "#1 / notes",
            ip: "192.0.2.10",
            ua: "Simulated browser",
            referrer: "Direct / unknown",
            country: "Unknown",
            city: "Unknown",
            browser: "Firefox",
            os: "Linux",
            device: "Desktop",
            classification: "human",
          },
        ],
      },
    },
  },
};
