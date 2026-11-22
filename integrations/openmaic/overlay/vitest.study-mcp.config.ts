import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    include: ["lib/study-mcp/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
  },
});
