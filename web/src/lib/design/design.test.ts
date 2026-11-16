import { describe, it, expect } from "vitest";
import { render, fireEvent, within } from "@testing-library/svelte";
import DesignHarness from "./DesignHarness.svelte";
import DesignCompare from "./DesignCompare.svelte";

describe("selected Precision workspace", () => {
  it("creates and edits inside one modal, retaining invalid drafts and cancelling without changes", async () => {
    const v = render(DesignHarness);
    await fireEvent.click(v.getByTitle("Clicks for Field notes"));
    await fireEvent.click(v.getByText("Create link"));
    expect(v.container.querySelector(".dl-popover")).toBeNull();
    expect(v.container.querySelectorAll(".dl-modal")).toHaveLength(1);
    await fireEvent.input(v.getByPlaceholderText("A useful name"), {
      target: { value: "Cancelled draft" },
    });
    await fireEvent.click(v.getByText("Save link"));
    expect(
      v
        .getByText("Enter a full http:// or https:// destination.")
        .closest(".dl-modal"),
    ).toBeTruthy();
    expect(
      (v.getByPlaceholderText("A useful name") as HTMLInputElement).value,
    ).toBe("Cancelled draft");
    expect(v.container.textContent).not.toMatch(
      /preview session|local preview|saved only/i,
    );
    await fireEvent.click(v.getByText("Cancel"));
    expect(v.container.querySelector(".dl-modal")).toBeNull();
    expect(v.queryByText("Cancelled draft")).toBeNull();
    await fireEvent.click(v.getByTitle("Edit Autumn archive"));
    await fireEvent.input(v.getByPlaceholderText("A useful name"), {
      target: { value: "Renamed archive" },
    });
    await fireEvent.click(v.getByText("Save link"));
    expect(v.getByText("Renamed archive")).toBeTruthy();
    expect(v.getByTitle("Enable Renamed archive")).toBeTruthy();
    expect(v.container.querySelector(".dl-modal")).toBeNull();
    expect(v.getByText("Link updated.")).toBeTruthy();
    await fireEvent.click(v.getByText("Create link"));
    await fireEvent.click(v.getByTitle("Close dialog"));
    expect(v.container.querySelector(".dl-modal")).toBeNull();
    await fireEvent.click(v.getByText("Create link"));
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(v.container.querySelector(".dl-modal")).toBeNull();
  });
  it("opens row details beside the selected action and replaces or dismisses them", async () => {
    const v = render(DesignHarness);
    await fireEvent.click(v.getByTitle("Clicks for Release handbook"));
    let details = v.container.querySelector(".dl-popover") as HTMLElement;
    expect(details).not.toBeNull();
    expect(within(details).getByText("Release handbook")).toBeTruthy();
    expect(within(details).getByText("386")).toBeTruthy();
    expect(within(details).getByText("Clicks")).toBeTruthy();
    expect(details.textContent).not.toMatch(/humans?|bots|previews/i);
    await fireEvent.click(v.getByTitle("Show address for Field notes"));
    details = v.container.querySelector(".dl-popover") as HTMLElement;
    expect(v.container.querySelectorAll(".dl-popover")).toHaveLength(1);
    expect(within(details).getByText("Field notes")).toBeTruthy();
    expect(within(details).getByDisplayValue("example.com/notes")).toBeTruthy();
    expect(details.textContent).not.toMatch(/copied/i);
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(v.container.querySelector(".dl-popover")).toBeNull();
    await fireEvent.click(v.getByTitle("Clicks for Field notes"));
    await fireEvent.pointerDown(v.getByText("Shortener"));
    expect(v.container.querySelector(".dl-popover")).toBeNull();
  });
  it("labels the existing click count without human or bot explanations", async () => {
    const v = render(DesignHarness);
    expect(v.getByRole("columnheader", { name: /^Clicks$/ })).toBeTruthy();
    await fireEvent.click(v.getByTitle("Clicks for Field notes"));
    const details = v.container.querySelector(".dl-popover") as HTMLElement;
    expect(within(details).getByText("Clicks")).toBeTruthy();
    expect(within(details).getByText("1,284")).toBeTruthy();
    expect(v.container.textContent).not.toMatch(
      /humans?|bots|previews excluded/i,
    );
  });
  it("opens the default story with one Links heading and no review or specimen chrome", () => {
    const v = render(DesignCompare);
    expect(v.container.querySelectorAll(".app-shell")).toHaveLength(1);
    expect(v.getByText("Actions").getAttribute("colspan")).toBe("6");
    expect(
      v.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual(["Links"]);
    for (const copy of [
      "Language kit",
      "Tokens & components",
      "Surfaces & meaning",
      "Control vocabulary",
      "Validation · beside the field",
      "Inter / system sans",
      "Skill baseline",
      "One workspace. Three directions.",
      "Personal workspace",
      "Workspace / Links",
      "Short aliases resolve",
      "Enable or pause",
      "Bots and previews excluded",
      "Use hyphens instead of spaces.",
    ]) {
      expect(v.container.textContent).not.toContain(copy);
    }
    expect(
      v.container.querySelectorAll(
        ".dl-error, .dl-specimens, .dl-metrics, .dl-eyebrow, .dl-review, .dl-heading-dot",
      ),
    ).toHaveLength(0);
    expect(v.getByText("Shortener")).toBeTruthy();
    expect(v.getByText("3 links")).toBeTruthy();
    expect(v.getAllByText("+ Create link")).toHaveLength(1);
  });
});

describe("design preview local interactions", () => {
  it.each(["precision", "paper", "studio"] as const)(
    "%s keeps an identity-based enable change when search is cleared",
    async (direction) => {
      const v = render(DesignHarness, { direction });
      await fireEvent.input(v.getByPlaceholderText("Search links"), {
        target: { value: "release" },
      });
      expect(v.queryByText("Field notes")).toBeNull();
      await fireEvent.click(v.getByTitle("Disable Release handbook"));
      await fireEvent.input(v.getByPlaceholderText("Search links"), {
        target: { value: "" },
      });
      expect(v.queryByTitle("Enable Release handbook")).not.toBeNull();
      expect(v.getByText("Field notes")).toBeTruthy();
    },
  );
  it("preserves invalid input beside the form, then creates a valid alias", async () => {
    const v = render(DesignHarness);
    await fireEvent.click(v.getAllByText("Create link")[0]);
    await fireEvent.input(v.getByPlaceholderText("A useful name"), {
      target: { value: "Project notes" },
    });
    await fireEvent.input(v.getByPlaceholderText("e.g. project-notes"), {
      target: { value: "notes" },
    });
    await fireEvent.input(v.getByPlaceholderText("https://example.org/page"), {
      target: { value: "not-a-url" },
    });
    await fireEvent.click(v.getByText("Save link"));
    expect(
      v.getByText("Enter a full http:// or https:// destination."),
    ).toBeTruthy();
    expect(
      (v.getByPlaceholderText("A useful name") as HTMLInputElement).value,
    ).toBe("Project notes");
    await fireEvent.input(v.getByPlaceholderText("https://example.org/page"), {
      target: { value: "https://example.org/project" },
    });
    await fireEvent.click(v.getByText("Save link"));
    expect(
      v.getByText("This alias is already in use. Choose another alias."),
    ).toBeTruthy();
    await fireEvent.input(v.getByPlaceholderText("e.g. project-notes"), {
      target: { value: "project-notes" },
    });
    await fireEvent.click(v.getByText("Save link"));
    expect(v.getByText("example.com/project-notes")).toBeTruthy();
    expect(v.getByText("Project notes")).toBeTruthy();
  });
});
