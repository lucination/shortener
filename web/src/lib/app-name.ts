export const DEFAULT_APP_NAME = "Shortener";
/** Display text only: never interpret an environment value as markup. */
export const resolveAppName = (value?: string): string =>
  value?.trim() || DEFAULT_APP_NAME;
