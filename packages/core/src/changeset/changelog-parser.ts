/**
 * Extract the content of a specific version section from a CHANGELOG.md string.
 * Looks for headers like `## 1.3.0` or `## v1.3.0`.
 * Returns the section content (without the header) or null if not found.
 */
export function parseChangelogSection(
  changelog: string,
  version: string,
): string | null {
  const normalizedVersion = version.replace(/^v/, "");
  const escapedVersion = normalizedVersion.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const headerPattern = new RegExp(`^## v?${escapedVersion}\\b[^\\n]*\\n`, "m");
  const headerMatch = headerPattern.exec(changelog);
  if (!headerMatch) return null;

  const start = headerMatch.index + headerMatch[0].length;
  const nextHeader = changelog.indexOf("\n## ", start);
  const end = nextHeader === -1 ? changelog.length : nextHeader;
  return changelog.slice(start, end).trim();
}
