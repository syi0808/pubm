import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { googleSiteVerification } from "./src/consts/site-verification.js";

const websiteRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(websiteRoot, "..");
const pluginSourceDir = resolve(repoRoot, "plugins/pubm-plugin");
const pluginTargetDir = resolve(websiteRoot, "public/plugins/pubm-plugin");

function syncPubmPlugin() {
  if (!existsSync(pluginSourceDir)) {
    throw new Error(`pubm plugin source not found: ${pluginSourceDir}`);
  }

  rmSync(pluginTargetDir, { recursive: true, force: true });
  mkdirSync(resolve(websiteRoot, "public/plugins"), { recursive: true });
  cpSync(pluginSourceDir, pluginTargetDir, { recursive: true });
}

function pubmPluginStaticSync() {
  return {
    name: "pubm-plugin-static-sync",
    hooks: {
      "astro:config:setup"({ updateConfig }) {
        syncPubmPlugin();

        updateConfig({
          vite: {
            plugins: [
              {
                name: "pubm-plugin-static-sync",
                buildStart() {
                  syncPubmPlugin();
                },
              },
            ],
          },
        });
      },
    },
  };
}

export default defineConfig({
  site: "https://syi0808.github.io",
  base: "/pubm",
  integrations: [
    pubmPluginStaticSync(),
    starlight({
      title: "pubm",
      head: [
        {
          tag: "meta",
          attrs: {
            name: "google-site-verification",
            content: googleSiteVerification,
          },
        },
      ],
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
            { label: "CI/CD", slug: "guides/ci-cd" },
            { label: "Coding Agents", slug: "guides/coding-agents" },
            { label: "Troubleshooting", slug: "guides/troubleshooting" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Reference", slug: "reference/cli" },
            { label: "Config API", slug: "reference/config" },
            { label: "Plugins API", slug: "reference/plugins" },
            { label: "Official Plugins", slug: "reference/official-plugins" },
          ],
        },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
