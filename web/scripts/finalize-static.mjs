import { copyFile } from "node:fs/promises";
// Loco serves index.html at /; retain 200.html for its agreed SPA fallback.
await copyFile("build/200.html", "build/index.html");
console.log(
  "Static SPA entrypoints ready: build/index.html and build/200.html",
);
