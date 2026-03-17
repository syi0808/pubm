import { defineConfig } from "@pubm/core";
export default defineConfig({
  versioning: "independent",
  packages: [
    { path: "packages/a" },
    { path: "packages/b" },
  ],
});
