import { copyFile, readdir, readFile, writeFile } from "node:fs/promises";
// Loco serves index.html at /; retain 200.html for its agreed SPA fallback.
await copyFile("build/200.html", "build/index.html");
// Native password/continue documents consume the actual compiled app tokens/styles.
const assets = "build/_app/immutable/assets";
const styles = (await readdir(assets))
  .filter((file) => file.endsWith(".css"))
  .sort();
await writeFile(
  "build/presentation.css",
  (
    await Promise.all(
      styles.map((file) => readFile(`${assets}/${file}`, "utf8")),
    )
  ).join("\n"),
);
console.log(
  "Static SPA entrypoints ready: build/index.html and build/200.html",
);
