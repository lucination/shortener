import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
it("keeps presentation stateless and effect-free; fixtures never enter the app shell", () => {
  const root = join(process.cwd(), "src/lib");
  for (const file of readdirSync(root).filter((file) =>
    file.endsWith(".svelte"),
  )) {
    const content = readFileSync(join(root, file), "utf8");
    expect(content, file).not.toMatch(
      /\$state\s*\(|\bfetch\s*\(|localStorage|sessionStorage|onMount|from ['"].*adapters|from ['"].*containers/,
    );
  }
  expect(
    readFileSync(join(root, "containers/AppContainer.svelte"), "utf8"),
  ).not.toMatch(/from ['"].*fixtures/);
});
