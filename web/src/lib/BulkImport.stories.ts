import BulkImport from "./BulkImport.svelte";
import { parseBulk } from "./bulk";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const text =
  "destination,alias\nhttps://example.org/notes,notes\nhttps://example.org/handbook,handbook";
const meta = {
  title: "Workspace/Bulk import",
  component: BulkImport,
  args: { text, rows: parseBulk(text), outcome: { kind: "idle" } },
} satisfies Meta<typeof BulkImport>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Review: Story = {};
export const InvalidRows: Story = {
  args: {
    text: text + "\njavascript:alert(1),bad",
    rows: parseBulk(text + "\njavascript:alert(1),bad"),
  },
};
export const Pending: Story = { args: { outcome: { kind: "pending" } } };
export const PartialFailure: Story = {
  args: {
    outcome: {
      kind: "error",
      message:
        "Row 2: alias reserved. Row 3: created. Refresh before retrying to avoid duplicates.",
    },
  },
};
