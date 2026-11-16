import Dashboard from "./Dashboard.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
import { simulatedLinkRows } from "./fixtures";
const meta = {
  title: "Workspace/Links",
  component: Dashboard,
  args: {
    search: "",
    selected: [],
    state: {
      kind: "ready",
      value: [
        {
          id: 1,
          label: "Field notes",
          destination: "https://example.org/notes?edition=12",
          address: "example.com/notes",
          clicks: 1284,
          enabled: true,
        },
        {
          id: 2,
          label: "Release handbook",
          destination: "https://example.org/handbook",
          address: "example.com/release",
          clicks: 386,
          enabled: true,
        },
        {
          id: 3,
          label: "Autumn archive",
          destination: "https://example.org/archive",
          address: "example.com/autumn",
          clicks: 92,
          enabled: false,
        },
      ],
    },
  },
  parameters: {
    docs: {
      description: {
        component:
          "SIMULATED presentation fixtures. Controlled production component; no backend adapter, storage, or network.",
      },
    },
  },
} satisfies Meta<typeof Dashboard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Populated: Story = {
  args: { state: { kind: "ready", value: simulatedLinkRows } },
};
export const Selected: Story = { args: { selected: [1, 2] } };
export const Empty: Story = { args: { state: { kind: "ready", value: [] } } };
export const Pending: Story = { args: { state: { kind: "pending" } } };
export const Error: Story = {
  args: {
    state: {
      kind: "error",
      message: "The link list could not be loaded. Your links are unchanged.",
    },
  },
};

export const Copied: Story = {
  args: {
    copyFeedback: { kind: "success", id: 1, message: "Short address copied." },
  },
};
export const ClipboardUnavailable: Story = {
  args: {
    copyFeedback: {
      kind: "error",
      id: 1,
      message: "Clipboard unavailable. Select and copy the short address.",
    },
  },
};
