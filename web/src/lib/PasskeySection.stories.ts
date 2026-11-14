import PasskeySection from "./PasskeySection.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Access/Passkey",
  component: PasskeySection,
  args: { state: { kind: "idle" } },
} satisfies Meta<typeof PasskeySection>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Idle: Story = {};
export const Enrolling: Story = { args: { state: { kind: "enrolling" } } };
export const Succeeded: Story = {
  args: {
    state: { kind: "succeeded", message: "Passkey added to your account." },
  },
};
export const Failed: Story = {
  args: {
    state: {
      kind: "failed",
      message: "Enrollment cancelled. Try again when ready.",
    },
  },
};
