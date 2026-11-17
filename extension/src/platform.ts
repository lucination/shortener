import type { Page } from "./core.js";
export interface ExtensionApi {
  tabs: {
    query(query: { active: boolean; currentWindow: boolean }): Promise<Page[]>;
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  permissions: {
    contains(value: { origins: string[] }): Promise<boolean>;
    request(value: { origins: string[] }): Promise<boolean>;
    remove(value: { origins: string[] }): Promise<boolean>;
  };
  runtime: { openOptionsPage(): Promise<void> };
}
declare global {
  var browser: ExtensionApi | undefined;
  var chrome: ExtensionApi;
}
export function extensionApi(): ExtensionApi {
  return globalThis.browser ?? globalThis.chrome;
}
