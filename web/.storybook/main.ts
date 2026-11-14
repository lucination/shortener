import type { StorybookConfig } from "@storybook/sveltekit";
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.ts"],
  framework: "@storybook/sveltekit",
  staticDirs: ["../static"],
};
export default config;
