import { color } from "@pubm/runner";
import semver from "semver";
import type { ResolvedPackageConfig } from "../../config/types.js";
import { t } from "../../i18n/index.js";
import { packageKey } from "../../utils/package-key.js";
import { ui } from "../../utils/ui.js";
import type { VersionRecommendation } from "../../version-source/types.js";

const { SemVer } = semver;

export type PackageNotes = Map<string, string[]>;

export function pluralize(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

export function displayRecommendationSummary(
  recommendations: VersionRecommendation[],
): string {
  const lines: string[] = ["", "  Version Recommendations", ""];
  const sourceWidth = 10;
  const pkgWidth = Math.max(
    ...recommendations.map((r) => r.packagePath.length),
    7,
  );
  const bumpWidth = 7;
  lines.push(
    `  ${"Source".padEnd(sourceWidth)} ${"Package".padEnd(pkgWidth)} ${"Bump".padEnd(bumpWidth)} Details`,
  );
  lines.push(
    `  ${"-".repeat(sourceWidth)} ${"-".repeat(pkgWidth)} ${"-".repeat(bumpWidth)} ${"-".repeat(20)}`,
  );
  for (const rec of recommendations) {
    const source = rec.source === "changeset" ? "changeset" : "commit";
    const detail = rec.entries[0]?.summary ?? "";
    const more =
      rec.entries.length > 1 ? ` (+${rec.entries.length - 1} more)` : "";
    const detailDisplay =
      rec.source === "changeset" ? `"${detail}"${more}` : `${detail}${more}`;
    lines.push(
      `  ${source.padEnd(sourceWidth)} ${rec.packagePath.padEnd(pkgWidth)} ${rec.bumpType.padEnd(bumpWidth)} ${detailDisplay}`,
    );
  }
  lines.push("", `  ${recommendations.length} packages to bump`, "");
  return lines.join("\n");
}

function formatPackageVersionSummary(
  currentVersion: string,
  selectedVersion?: string,
): string {
  const current = color.dim(`v${currentVersion}`);

  if (!selectedVersion || selectedVersion === currentVersion) {
    return current;
  }

  return `${current} -> ${color.dim(`v${selectedVersion}`)}`;
}

export function buildDependencyBumpNote(
  currentVersion: string,
  bumpedDependencies: string[],
): string {
  const suggestedVersion = new SemVer(currentVersion).inc("patch").toString();
  const dependencyLabel =
    bumpedDependencies.length === 1 ? "dependency" : "dependencies";

  return ui.formatNote(
    "hint",
    t("note.dependency.bumped", {
      label: dependencyLabel,
      dependencies: bumpedDependencies.join(", "),
      version: suggestedVersion,
    }),
  );
}

export function renderPackageVersionSummary(
  packageInfos: ResolvedPackageConfig[],
  _currentVersions: Map<string, string>,
  selectedVersions: Map<string, string>,
  options: {
    activePackage?: string;
    notes?: PackageNotes;
  } = {},
): string {
  const lines = [t("output.packages")];

  for (const pkg of packageInfos) {
    const currentVersion = pkg.version;
    const selectedVersion = selectedVersions.get(packageKey(pkg));
    const prefix = options.activePackage === pkg.path ? "> " : "  ";

    lines.push(
      `${prefix}${pkg.name}  ${formatPackageVersionSummary(currentVersion, selectedVersion)}`,
    );

    for (const note of options.notes?.get(pkg.path) ?? []) {
      lines.push(`    ${note}`);
    }
  }

  return lines.join("\n");
}
