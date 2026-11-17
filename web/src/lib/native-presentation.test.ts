import { it, expect } from "vitest";
import { readFileSync } from "node:fs";

it("keeps critical native tokens equal to the shared application theme", () => {
  const tokens = (css: string) =>
    new Map(
      [...css.matchAll(/(--dl-[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [
        name,
        value.replace(/\s/g, ""),
      ]),
    );
  const native = tokens(
    readFileSync("src/lib/presentation/native-critical.css", "utf8"),
  );
  const shared = tokens(
    readFileSync("src/lib/styles/presentation.css", "utf8"),
  );
  for (const [name, value] of native)
    expect(value, name).toBe(shared.get(name));
  expect(native.size).toBe(6);
});

it("keeps native public and emergency documents themed without depending on static assets", () => {
  const document = readFileSync(
    "src/lib/presentation/native-document.html",
    "utf8",
  );
  const server = readFileSync("../src/http.rs", "utf8");
  expect(document).toContain("<style>{style}</style>");
  expect(server).toContain(
    'style = include_str!("../web/src/lib/presentation/native-critical.css")',
  );
  expect(server).toMatch(
    /public_document\(\s*"Development frontend unavailable"/,
  );
  expect(server).toMatch(/public_document\(\s*"Application unavailable"/);
  expect(document).not.toMatch(/<script|<nav|\/api\//);
  expect(server).toContain(
    'public_document("Link not found", "<h1>Link not found</h1>".into())',
  );
});
