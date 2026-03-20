import { defineConfig } from "@pubm/core";
import { brewTap } from "@pubm/plugin-brew";
import { externalVersionSync } from "@pubm/plugin-external-version-sync";

export default defineConfig({
  versioning: "independent",
  excludeRelease: ["packages/pubm/platforms/*"],
  packages: [
    { path: "packages/core" },
    { path: "packages/pubm" },
    { path: "packages/pubm/platforms/*" },
    { path: "packages/plugins/plugin-external-version-sync" },
    { path: "packages/plugins/plugin-brew" },
  ],
  releaseAssets: [
    {
      packagePath: "packages/pubm",
      files: ["platforms/{platform}/bin/pubm"],
      name: "pubm-{platform}",
    },
  ],
  plugins: [
    brewTap({
      formula: "Formula/pubm.rb",
      packageName: "pubm",
      repo: "syi0808/homebrew-pubm",
    }),
    externalVersionSync({
      targets: [
        {
          file: "website/src/i18n/landing.ts",
          pattern: /v\d+\.\d+\.\d+/g,
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
      version: (packages) => packages.get("packages/core") ?? "",
    }),
  ],
});
