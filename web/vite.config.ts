import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: ["localhost"],
    fs: { strict: true, allow: [fileURLToPath(new URL(".", import.meta.url))] },
    hmr: {
      protocol: "ws",
      host: "localhost",
      clientPort: 3000,
      path: "/__frontend_hmr",
    },
  },
  plugins: [tailwindcss(), sveltekit()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
    server: { deps: { inline: ["@testing-library/svelte"] } },
  },
  resolve: { conditions: ["browser"] },
});
