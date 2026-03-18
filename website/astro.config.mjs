import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
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

const docsSidebar = [
  {
    label: "Getting Started",
    translations: {
      ko: "시작하기",
      "zh-CN": "入门",
      fr: "Bien demarrer",
      de: "Erste Schritte",
      es: "Primeros pasos",
    },
    items: [
      {
        label: "Quick Start",
        translations: {
          ko: "빠른 시작",
          "zh-CN": "快速开始",
          fr: "Demarrage rapide",
          de: "Schnellstart",
          es: "Inicio rapido",
        },
        slug: "guides/quick-start",
      },
      {
        label: "Configuration",
        translations: {
          ko: "설정",
          "zh-CN": "配置",
          fr: "Configuration",
          de: "Konfiguration",
          es: "Configuracion",
        },
        slug: "guides/configuration",
      },
    ],
  },
  {
    label: "Guides",
    translations: {
      ko: "가이드",
      "zh-CN": "指南",
      fr: "Guides",
      de: "Anleitungen",
      es: "Guias",
    },
    items: [
      {
        label: "Monorepo",
        translations: {
          ko: "모노레포",
          "zh-CN": "Monorepo",
          fr: "Monorepo",
          de: "Monorepo",
          es: "Monorepo",
        },
        slug: "guides/monorepo",
      },
      {
        label: "Changesets",
        translations: {
          ko: "변경셋",
          "zh-CN": "变更集",
          fr: "Changesets",
          de: "Changesets",
          es: "Changesets",
        },
        slug: "guides/changesets",
      },
      {
        label: "CI/CD",
        translations: {
          ko: "CI/CD",
          "zh-CN": "CI/CD",
          fr: "CI/CD",
          de: "CI/CD",
          es: "CI/CD",
        },
        slug: "guides/ci-cd",
      },
      {
        label: "Coding Agents",
        translations: {
          ko: "코딩 에이전트",
          "zh-CN": "编码代理",
          fr: "Agents de code",
          de: "Coding Agents",
          es: "Agentes de codigo",
        },
        slug: "guides/coding-agents",
      },
      {
        label: "Troubleshooting",
        translations: {
          ko: "문제 해결",
          "zh-CN": "故障排查",
          fr: "Depannage",
          de: "Fehlerbehebung",
          es: "Solucion de problemas",
        },
        slug: "guides/troubleshooting",
      },
    ],
  },
  {
    label: "Reference",
    translations: {
      ko: "레퍼런스",
      "zh-CN": "参考",
      fr: "Reference",
      de: "Referenz",
      es: "Referencia",
    },
    items: [
      {
        label: "CLI Reference",
        translations: {
          ko: "CLI 레퍼런스",
          "zh-CN": "CLI 参考",
          fr: "Reference CLI",
          de: "CLI-Referenz",
          es: "Referencia CLI",
        },
        slug: "reference/cli",
      },
      {
        label: "Core SDK",
        translations: {
          ko: "Core SDK",
          "zh-CN": "Core SDK",
          fr: "SDK Core",
          de: "Core-SDK",
          es: "SDK Core",
        },
        slug: "reference/sdk",
      },
      {
        label: "Plugins API",
        translations: {
          ko: "Plugins API",
          "zh-CN": "Plugins API",
          fr: "API des plugins",
          de: "Plugins-API",
          es: "API de plugins",
        },
        slug: "reference/plugins",
      },
      {
        label: "Official Plugins",
        translations: {
          ko: "공식 플러그인",
          "zh-CN": "官方插件",
          fr: "Plugins officiels",
          de: "Offizielle Plugins",
          es: "Plugins oficiales",
        },
        slug: "reference/official-plugins",
      },
    ],
  },
];

export default defineConfig({
  site: "https://syi0808.github.io",
  base: "/pubm",
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/plugins/"),
    }),
    pubmPluginStaticSync(),
    starlight({
      title: "pubm",
      description:
        "Publish across npm, jsr, crates.io, and private registries from one command.",
      locales: {
        root: { label: "English", lang: "en" },
        ko: { label: "한국어", lang: "ko" },
        "zh-cn": { label: "简体中文", lang: "zh-CN" },
        fr: { label: "Français", lang: "fr" },
        de: { label: "Deutsch", lang: "de" },
        es: { label: "Español", lang: "es" },
      },
      defaultLocale: "root",
      head: [
        {
          tag: "meta",
          attrs: {
            name: "google-site-verification",
            content: googleSiteVerification,
          },
        },
        { tag: "meta", attrs: { property: "og:site_name", content: "pubm" } },
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content:
              "https://syi0808.github.io/pubm/logo_typo_with_transparent.png",
          },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content:
              "https://syi0808.github.io/pubm/logo_typo_with_transparent.png",
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
      sidebar: docsSidebar,
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
