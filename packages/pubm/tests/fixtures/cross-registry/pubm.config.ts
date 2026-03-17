import { defineConfig } from "@pubm/core";
export default defineConfig({
  packages: [
    { path: "packages/core", registries: ["npm", "jsr"] },
  ],
});
