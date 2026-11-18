import type { Preview } from "@storybook/sveltekit";
import "../src/app.css";

// Stories share production's single workspace scope (`.app-shell`). Page
// stories that own a different shell (the sign-in page) opt out.
const preview: Preview = {
  parameters: { layout: "fullscreen" },
  beforeEach: ({ parameters }) => {
    document
      .getElementById("storybook-root")
      ?.classList.toggle("app-shell", parameters.workspaceScope !== false);
  },
};
export default preview;
