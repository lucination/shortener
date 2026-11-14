import { it, expect } from "vitest";
import { transition } from "./transitions";
import { toggleSelection, filterLinks } from "./view-models";
it("withdraws stale results during reload and exposes only resolved state", () => {
  expect(transition({ kind: "ready", value: [1] }, { kind: "start" })).toEqual({
    kind: "pending",
  });
  expect(
    transition({ kind: "pending" }, { kind: "reject", message: "offline" }),
  ).toEqual({ kind: "error", message: "offline" });
  expect(
    transition({ kind: "pending" }, { kind: "resolve", value: [2] }),
  ).toEqual({ kind: "ready", value: [2] });
});
it("keeps selection identity immutable through toggles", () => {
  const ids = Object.freeze([7]);
  expect(toggleSelection(ids, 9)).toEqual([7, 9]);
  expect(toggleSelection(ids, 7)).toEqual([]);
  expect(ids).toEqual([7]);
});
it("filters purely across title, destination and alias", () => {
  const rows = Object.freeze([
    {
      id: 7,
      label: "Field notes",
      destination: "https://example.org/notes",
      address: "example.com/journal",
      clicks: 1,
      enabled: true,
    },
  ]);
  expect(filterLinks(rows, " JOURNAL ")).toEqual(rows);
  expect(filterLinks(rows, "missing")).toEqual([]);
});
