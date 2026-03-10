import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["tests/setup.ts"],
    pool: "forks",
    testTimeout: 30000,
    passWithNoTests: true,
  },
});
