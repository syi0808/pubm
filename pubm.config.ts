import { defineConfig } from "@pubm/core";
import { defineConfig as defineConfigVitest } from "vitest/config";

console.log("vitest defineConfig loaded:", typeof defineConfigVitest);

export default defineConfig({
  versioning: "independent",
  packages: [
    { path: "packages/core", registries: ["npm", "jsr"] },
    { path: "packages/cli", registries: ["npm"] },
    {
      path: "packages/plugins/plugin-external-version-sync",
      registries: ["npm", "jsr"],
    },
    { path: "packages/plugins/plugin-brew", registries: ["npm", "jsr"] },
  ],
});
