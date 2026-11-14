import LinkEditor from "./LinkEditor.svelte";
import { emptyDraft } from "./view-models";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Workspace/Editor",
  component: LinkEditor,
  args: {
    mode: { kind: "create" },
    draft: {
      ...emptyDraft,
      destination: "https://example.org/field-notes",
      title: "Field notes",
    },
    outcome: { kind: "idle" },
  },
} satisfies Meta<typeof LinkEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Create: Story = {};
export const Edit: Story = {
  args: {
    mode: { kind: "edit", id: 1 },
    draft: {
      ...emptyDraft,
      destination: "https://example.org/field-notes",
      title: "Field notes",
      alias: "notes",
      clickLimit: "5000",
      queryMode: "preserve",
      interstitial: true,
    },
  },
};
export const Saving: Story = { args: { outcome: { kind: "pending" } } };
export const Conflict: Story = {
  args: {
    outcome: {
      kind: "error",
      message: "That alias is already reserved. Choose another alias.",
    },
  },
};
