import { defineConfig } from "../../../src/config/types.js";

export default defineConfig({
  release: {
    versioning: {
      mode: "fixed",
    },
  },
  branch: "release",
  registries: ["npm"],
});
