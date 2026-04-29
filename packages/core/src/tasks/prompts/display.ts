import { color } from "@pubm/runner";
import semver from "semver";
import type { ResolvedPackageConfig } from "../../config/types.js";
import { t } from "../../i18n/index.js";
import { packageKey } from "../../utils/package-key.js";
import { ui } from "../../utils/ui.js";
import type { VersionRecommendation } from "../../version-source/types.js";

const { SemVer } = semver;
const DETAILS_MAX_WIDTH = 48;

export type PackageNotes = Map<string, string[]>;

export function pluralize(count: number, singular: string): string {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}

export function displayRecommendationSummary(
  recommendations: VersionRecommendation[],
): string {
  const lines: string[] = ["", color.bold("Version Recommendations"), ""];

  const tableRows = recommendations.map((rec) => ({
    packagePath: rec.packagePath,
    bumpType: rec.bumpType,
    source: rec.source,
    sourceLabel: sourceLabel(rec.source),
    detail: formatRecommendationDetail(rec),
  }));
  const packageWidth = columnWidth(
    "Package",
    tableRows.map((r) => r.packagePath),
  );
  const bumpWidth = columnWidth(
    "Bump",
    tableRows.map((r) => r.bumpType),
  );
  const sourceWidth = columnWidth(
    "Source",
    tableRows.map((r) => r.sourceLabel),
  );
  const detailsWidth = columnWidth(
    "Details",
    tableRows.map((r) => r.detail),
    DETAILS_MAX_WIDTH,
  );

  lines.push(
    color.dim(
      formatPlainTableRow(
        ["Package", "Bump", "Source", "Details"],
        [packageWidth, bumpWidth, sourceWidth, detailsWidth],
      ),
    ),
  );
  lines.push(
    color.dim(
      formatTableDivider([packageWidth, bumpWidth, sourceWidth, detailsWidth]),
    ),
  );

  for (const row of tableRows) {
    lines.push(
      `${color.bold(row.packagePath.padEnd(packageWidth))} | ${formatBumpType(row.bumpType, bumpWidth)} | ${formatSource(row.source, sourceWidth)} | ${truncateCell(row.detail, detailsWidth)}`,
    );
  }

  lines.push(
    "",
    `${color.bold(String(recommendations.length))} packages to bump`,
    "",
  );
  return lines.join("\n");
}

function columnWidth(
  heading: string,
  values: string[],
  maxWidth?: number,
): number {
  const width = Math.max(
    heading.length,
    ...values.map((value) => value.length),
  );
  if (maxWidth === undefined) return width;
  return Math.min(width, Math.max(heading.length, maxWidth));
}

function formatPlainTableRow(values: string[], widths: number[]): string {
  return values
    .map((value, index) => value.padEnd(widths[index] ?? value.length))
    .join(" | ");
}

function formatTableDivider(widths: number[]): string {
  return widths.map((width) => "-".repeat(width)).join(" | ");
}

function formatBumpType(bumpType: string, width: number): string {
  const label = bumpType.padEnd(width);
  if (bumpType === "major") return color.redBright(label);
  if (bumpType === "minor") return color.cyan(label);
  return color.green(label);
}

function sourceLabel(source: string): string {
  if (source === "changeset") return "changeset";
  if (source === "commit") return "commit";
  return source;
}

function formatSource(source: string, width: number): string {
  const label = sourceLabel(source).padEnd(width);
  if (source === "changeset") return color.magenta(label);
  if (source === "commit") return color.cyan(label);
  return label;
}

function formatRecommendationDetail(rec: VersionRecommendation): string {
  const detail = rec.entries[0]?.summary ?? "";
  const more =
    rec.entries.length > 1 ? ` (+${rec.entries.length - 1} more)` : "";
  return rec.source === "changeset" ? `"${detail}"${more}` : `${detail}${more}`;
}

function truncateCell(value: string, width: number): string {
  if (value.length <= width) return value.padEnd(width);
  if (width <= 3) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

function formatPackageVersionSummary(
  currentVersion: string,
  selectedVersion?: string,
): string {
  const current = color.dim(`v${currentVersion}`);

  if (!selectedVersion || selectedVersion === currentVersion) {
    return current;
  }

  return `${current} ${color.dim("->")} ${color.green(`v${selectedVersion}`)}`;
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
      dependencies: color.bold(bumpedDependencies.join(", ")),
      version: color.green(suggestedVersion),
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
