import { it, expect } from "vitest";
import { parseBulk } from "./bulk";
it("validates pasted rows independently without hiding malformed destinations", () => {
  expect(
    parseBulk(
      "destination,alias\nhttps://example.org/one,one\njavascript:alert(1),bad",
    ),
  ).toEqual([
    {
      kind: "valid",
      row: 2,
      destination: "https://example.org/one",
      alias: "one",
    },
    {
      kind: "invalid",
      row: 3,
      message: "Destination must be an http:// or https:// URL.",
    },
  ]);
});
it("parses escaped quoted URLs and rejects unbalanced quotes", () => {
  expect(parseBulk('"https://example.org/a,b",alias')).toEqual([
    {
      kind: "valid",
      row: 1,
      destination: "https://example.org/a,b",
      alias: "alias",
    },
  ]);
  expect(parseBulk('"https://example.org/a,alias')[0]).toMatchObject({
    kind: "invalid",
    row: 1,
  });
});
