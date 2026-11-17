import EditorStory from "./story-harness/EditorStory.svelte";
import { emptyDraft } from "./view-models";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Workspace/Editor",
  component: EditorStory,
  args: {
    mode: { kind: "create" },
    draft: {
      ...emptyDraft,
      destination: "https://example.org/field-notes",
      title: "Field notes",
    },
    outcome: { kind: "idle" },
  },
} satisfies Meta<typeof EditorStory>;
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

const longDraft = {
  ...emptyDraft,
  title: "Field notes",
  alias: "a".repeat(64),
  destination: `https://example.org/${"long-path/".repeat(30)}`,
};
export const LongAddress: Story = {
  args: { mode: { kind: "edit", id: 1 }, draft: longDraft },
};
export const EditFailure: Story = {
  args: {
    mode: { kind: "edit", id: 1 },
    draft: longDraft,
    outcome: {
      kind: "error",
      message: "The link could not be saved. Your input is unchanged.",
    },
  },
};
