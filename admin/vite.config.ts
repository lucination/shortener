import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    allowedHosts: ["localhost"],
    fs: { strict: true, allow: [resolve("."), resolve("../web")] },
    hmr: {
      protocol: "ws",
      host: "localhost",
      clientPort: 3000,
      path: "/__admin_hmr",
    },
  },
});
