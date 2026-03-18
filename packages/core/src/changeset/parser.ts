import { parse as parseYaml } from "yaml";

export type BumpType = "patch" | "minor" | "major";

export interface Release {
  path: string;
  type: BumpType;
}

export interface Changeset {
  id: string;
  summary: string;
  releases: Release[];
}

const VALID_BUMP_TYPES = new Set(["patch", "minor", "major"]);

export function parseChangeset(
  content: string,
  fileName: string,
  resolveKey?: (key: string) => string,
): Changeset {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    throw new Error(
      `Invalid changeset format in "${fileName}": missing frontmatter`,
    );
  }

  const yamlContent = match[1];
  const body = content.slice(match[0].length).trim();

  const parsed = parseYaml(yamlContent) as Record<string, string> | null;

  const releases: Release[] = [];

  if (parsed) {
    for (const [key, type] of Object.entries(parsed)) {
      if (!VALID_BUMP_TYPES.has(type)) {
        throw new Error(
          `Invalid bump type "${type}" for package "${key}" in "${fileName}". Expected: patch, minor, or major.`,
        );
      }
      const path = resolveKey ? resolveKey(key) : key;
      releases.push({ path, type: type as BumpType });
    }
  }

  const id = fileName.replace(/\.md$/, "");

  return {
    id,
    summary: body,
    releases,
  };
}
