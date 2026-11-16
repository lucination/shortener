import PublicPage from "./story-harness/PublicGateStory.svelte";
import type { Meta, StoryObj } from "@storybook/sveltekit";
const meta = {
  title: "Public/Redirect gates",
  component: PublicPage,
  args: {
    page: {
      kind: "preview",
      title: "Field notes",
      description: "Notes from the workshop, collected in one place.",
      destination: "https://example.org/notes?edition=12",
    },
    outcome: { kind: "idle" },
  },
} satisfies Meta<typeof PublicPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {};
export const Protected: Story = {
  args: { page: { kind: "password", password: "" } },
};
export const WrongPassword: Story = {
  args: {
    page: { kind: "password", password: "" },
    outcome: { kind: "error", message: "Incorrect password. Try again." },
  },
};
export const NotFound: Story = { args: { page: { kind: "not-found" } } };
