import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

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
      "astro:config:setup"({ addWatchFile, logger, updateConfig }) {
        syncPubmPlugin();
        addWatchFile(pluginSourceDir);

        updateConfig({
          vite: {
            plugins: [
              {
                name: "pubm-plugin-static-sync",
                buildStart() {
                  syncPubmPlugin();
                },
                configureServer(server) {
                  const resync = () => {
                    syncPubmPlugin();
                    logger.info("Synced plugins/pubm-plugin into public/plugins/pubm-plugin");
                    server.ws.send({ type: "full-reload" });
                  };

                  server.watcher.add(pluginSourceDir);
                  server.watcher.on("add", resync);
                  server.watcher.on("change", resync);
                  server.watcher.on("unlink", resync);
                  server.watcher.on("unlinkDir", resync);
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
