import { defineConfig, externalVersionSync } from "./dist/index.js";

export default defineConfig({
  registries: ["npm", "jsr"],
  plugins: [
    externalVersionSync({
      targets: [
        {
          file: "plugins/pubm-plugin/.claude-plugin/plugin.json",
          jsonPath: "version",
        },
      ],
    }),
  ],
});
