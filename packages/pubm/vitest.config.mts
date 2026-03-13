import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pubm/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["json-summary", "json", "text-summary"],
      reportOnFailure: true,
      include: ["src/**/*.ts"],
      exclude: ["src/commands/**"],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
      },
    },
    pool: "forks",
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
