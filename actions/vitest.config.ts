import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@pubm/core": path.resolve(
        import.meta.dirname,
        "../packages/core/src/index.ts",
      ),
      "@pubm/runner": path.resolve(
        import.meta.dirname,
        "../packages/runner/src/index.ts",
      ),
    },
  },
});
