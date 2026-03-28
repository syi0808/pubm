export interface VersionPrPackageInfo {
  name: string;
  version: string;
  bump: string;
}

export interface BuildVersionPrBodyOptions {
  packages: VersionPrPackageInfo[];
  changelogs: Map<string, string>;
}

export function buildVersionPrBody(options: BuildVersionPrBodyOptions): string {
  const lines: string[] = ["# Version Packages", ""];

  // Changes table
  lines.push("## Changes", "");
  lines.push("| Package | Version | Bump |");
  lines.push("|---------|---------|------|");
  for (const pkg of options.packages) {
    lines.push(`| ${pkg.name} | ${pkg.version} | ${pkg.bump} |`);
  }

  // Changelog sections
  const changelogEntries = options.packages.filter((pkg) =>
    options.changelogs.has(pkg.name),
  );
  if (changelogEntries.length > 0) {
    lines.push("", "## Changelog", "");
    for (const pkg of changelogEntries) {
      const changelog = options.changelogs.get(pkg.name);
      /* istanbul ignore next — Map.get always returns a value after has() check */
      if (changelog) {
        lines.push(`### ${pkg.name}@${pkg.version}`, "");
        lines.push(changelog, "");
      }
    }
  }

  return lines.join("\n").trimEnd();
}
