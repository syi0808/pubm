import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://syi0808.github.io",
  base: "/pubm",
  integrations: [
    starlight({
      title: "pubm",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/syi0808/pubm",
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Quick Start", slug: "guides/quick-start" },
            { label: "Configuration", slug: "guides/configuration" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Monorepo", slug: "guides/monorepo" },
            { label: "Changesets", slug: "guides/changesets" },
            { label: "Claude Code", slug: "guides/claude-code" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Reference", slug: "reference/cli" },
            { label: "Config API", slug: "reference/config" },
            { label: "Plugins API", slug: "reference/plugins" },
            { label: "Official Plugins", slug: "reference/official-plugins" },
            { label: "Plugin Marketplace", slug: "reference/marketplace" },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
