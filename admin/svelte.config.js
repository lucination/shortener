import adapter from "@sveltejs/adapter-static";
import { resolve } from "node:path";
export default {
  kit: {
    adapter: adapter({ fallback: "index.html" }),
    paths: { base: "/_" },
    alias: { $shared: resolve("../web/src/lib") },
  },
};
