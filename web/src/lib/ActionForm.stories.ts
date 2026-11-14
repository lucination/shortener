import ActionForm from "./ActionForm.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Workspace/Management",
  component: ActionForm,
  args: {
    view: {
      kind: "confirm",
      title: "Soft-delete 2 links?",
      description:
        "Redirects stop immediately. Existing addresses stay reserved permanently.",
    },
    outcome: { kind: "idle" },
  },
} satisfies Meta<typeof ActionForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ConfirmDelete: Story = {};
export const BulkExpiration: Story = {
  args: {
    view: {
      kind: "value",
      title: "Set expiration for 2 links",
      description:
        "Blank clears the current expiration. This affects only selected IDs.",
      label: "Expiration",
      value: "2026-12-31T23:59",
      type: "datetime-local",
    },
  },
};
export const BulkRetention: Story = {
  args: {
    view: {
      kind: "value",
      title: "Set raw-event retention",
      description:
        "Blank restores account default. Aggregates remain permanent.",
      label: "Retention days",
      value: "30",
      type: "number",
    },
  },
};
export const CreateUser: Story = {
  args: {
    view: {
      kind: "value",
      title: "Add user",
      description: "Only administrator-created accounts can sign in.",
      label: "Email address",
      value: "reader@example.org",
      type: "email",
    },
  },
};
