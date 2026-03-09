import { defineConfig, externalVersionSync } from "./dist/index.js";
import { brewTap } from "./plugins/plugin-brew/src/index.js";

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
    brewTap({ formula: "Formula/pubm.rb" }),
  ],
});
