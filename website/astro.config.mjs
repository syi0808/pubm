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
          label: "Reference",
          items: [{ label: "CLI Reference", slug: "reference/cli" }],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
