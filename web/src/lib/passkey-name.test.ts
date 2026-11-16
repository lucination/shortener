import { it, expect } from "vitest";
import { parsePasskeyName } from "./passkey-name";
it("matches Rust scalar, control and whitespace policy", () => {
  for (const value of [
    "x".repeat(80),
    "🔑".repeat(80),
    "a🔑".repeat(40),
    "x\ufeffx",
  ])
    expect(parsePasskeyName(value)).toBe(value);
  expect(parsePasskeyName("\u0085 Laptop \u0085")).toBe("Laptop");
  for (const value of [
    "",
    " ",
    "x".repeat(81),
    "🔑".repeat(81),
    "a🔑".repeat(40) + "x",
    "key\u0000name",
    "key\u007fname",
    "key\u0085name",
    "key\u009fname",
    "key\ud800",
    "key\udfff",
  ])
    expect(parsePasskeyName(value), JSON.stringify(value)).toBeUndefined();
});
