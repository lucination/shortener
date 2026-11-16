import { it, expect } from "vitest";
import { resolveAppName } from "./app-name";
it("resolves an optional public app name as plain trimmed text", () => {
  expect(resolveAppName()).toBe("Shortener");
  expect(resolveAppName("   ")).toBe("Shortener");
  expect(resolveAppName("  Fieldlinks  ")).toBe("Fieldlinks");
  expect(resolveAppName('<img src=x onerror="alert(1)">')).toBe(
    '<img src=x onerror="alert(1)">',
  );
});
