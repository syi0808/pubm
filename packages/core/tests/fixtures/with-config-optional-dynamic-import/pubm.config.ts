import { defineConfig as defineVitestConfig } from "vitest/config";

export default {
  branch: typeof defineVitestConfig === "function" ? "vitest" : "unknown",
  registries: ["npm"],
} as const;
