import { expect, it } from "vitest";
import { managementPath, managementUrl } from "./management";
it("parses only exact safe creator page paths and keeps aliases case-sensitive", () => {
  expect(managementPath("/Note-A/statistics")).toEqual({
    code: "Note-A",
    kind: "statistics",
  });
  expect(managementPath("/Note-A/edit")).toEqual({
    code: "Note-A",
    kind: "edit",
  });
  for (const path of [
    "/",
    "//Note-A/edit",
    "/Note-A/edit/",
    "/%4eote-A/edit",
    "/a%2fb/statistics",
    "/../edit",
    "/api/edit",
    "/a/edit/extra",
  ])
    expect(managementPath(path)).toBeNull();
  expect(managementUrl("Note-A", "statistics")).toBe("/Note-A/statistics");
  expect(managementUrl("//evil.test", "edit")).toBeNull();
});
