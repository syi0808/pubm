import { defineConfig } from "@pubm/core";
import { brewTap } from "@pubm/plugin-brew";
import { externalVersionSync } from "@pubm/plugin-external-version-sync";

export default defineConfig({
  versioning: "independent",
  packages: [
    { path: "packages/core" },
    { path: "packages/pubm" },
    { path: "packages/plugins/plugin-external-version-sync" },
    { path: "packages/plugins/plugin-brew" },
  ],
  plugins: [
    brewTap({ formula: "Formula/pubm.rb" }),
    externalVersionSync({
      targets: [
        {
          file: "website/src/components/landing/Hero.astro",
          pattern: /v\d+\.\d+\.\d+ available/,
        },
        {
          file: "plugins/pubm-plugin/.claude-plugin/plugin.json",
          jsonPath: "version",
        },
        {
          file: ".claude-plugin/marketplace.json",
          jsonPath: "metadata.version",
        },
        {
          file: ".claude-plugin/marketplace.json",
          jsonPath: "plugins.0.version",
        },
      ],
    }),
  ],
});
