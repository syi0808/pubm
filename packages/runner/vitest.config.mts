import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    coverage: {
      provider: "istanbul",
      reporter: ["json-summary", "json", "text-summary"],
      include: ["src/**/*.ts"],
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
