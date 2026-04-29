import { getCollection } from "astro:content";

const SITE_ORIGIN = "https://syi0808.github.io";
const SITE_BASE = "/pubm";

const LOCALE_PREFIXES = ["ko/", "zh-cn/", "fr/", "de/", "es/"] as const;

const DOC_GROUPS = [
  {
    title: "Getting Started",
    slugs: ["guides/quick-start", "guides/configuration"],
  },
  {
    title: "Guides",
    slugs: [
      "guides/monorepo",
      "guides/changesets",
      "guides/ci-cd",
      "guides/coding-agents",
      "guides/release-assets",
      "guides/asset-pipeline-hooks",
      "guides/troubleshooting",
    ],
  },
  {
    title: "Reference",
    slugs: [
      "reference/cli",
      "reference/sdk",
      "reference/plugins",
      "reference/official-plugins",
      "reference/platform-detection",
    ],
  },
] as const;

interface LlmsDoc {
  slug: string;
  title: string;
  description: string;
  body: string;
  url: string;
}

function normalizeEnglishSlug(id: string): string | null {
  if (LOCALE_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return null;
  }

  return id.replace(/\.(md|mdx)$/, "");
}

function docUrl(slug: string): string {
  return `${SITE_ORIGIN}${SITE_BASE}/${slug}/`;
}

async function loadEnglishDocs(): Promise<Map<string, LlmsDoc>> {
  const entries = await getCollection("docs");
  const docs = new Map<string, LlmsDoc>();

  for (const entry of entries) {
    const slug = normalizeEnglishSlug(entry.id);
    if (!slug) continue;

    docs.set(slug, {
      slug,
      title: entry.data.title,
      description: entry.data.description ?? "",
      body: entry.body.trim(),
      url: docUrl(slug),
    });
  }

  return docs;
}

async function orderedDocs(): Promise<
  Array<{ title: string; docs: LlmsDoc[] }>
> {
  const docsBySlug = await loadEnglishDocs();

  return DOC_GROUPS.map((group) => ({
    title: group.title,
    docs: group.slugs.map((slug) => {
      const doc = docsBySlug.get(slug);
      if (!doc) {
        throw new Error(`Missing English docs entry for ${slug}`);
      }
      return doc;
    }),
  }));
}

export async function renderLlmsTxt(): Promise<string> {
  const groups = await orderedDocs();
  const lines = [
    "# pubm",
    "",
    "> Publish to npm, jsr, crates.io, and private registries in one step. Automatic rollback if anything fails.",
    "",
    "pubm is a release orchestration CLI for projects that publish packages across multiple registries, packages, and ecosystems.",
    "",
  ];

  for (const group of groups) {
    lines.push(`## ${group.title}`, "");
    for (const doc of group.docs) {
      lines.push(`- [${doc.title}](${doc.url}): ${doc.description}`);
    }
    lines.push("");
  }

  lines.push(
    "## Optional",
    "",
    `- [Full documentation context](${SITE_ORIGIN}${SITE_BASE}/llms-full.txt): Flattened Markdown content for all English guides and reference docs.`,
    "",
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function renderLlmsFullTxt(): Promise<string> {
  const groups = await orderedDocs();
  const docs = groups.flatMap((group) => group.docs);
  const lines = [
    "# pubm Documentation",
    "",
    "> Full Markdown context for pubm's English guides and reference docs.",
    "",
    "## Contents",
    "",
  ];

  for (const doc of docs) {
    lines.push(`- [${doc.title}](${doc.url}): ${doc.description}`);
  }

  for (const doc of docs) {
    lines.push(
      "",
      "---",
      "",
      `## ${doc.title}`,
      "",
      `Source: ${doc.url}`,
      "",
      `Description: ${doc.description}`,
      "",
      doc.body,
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function textResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
