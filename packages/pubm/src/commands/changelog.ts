import process from "node:process";
import type { ChangelogEntry } from "@pubm/core";
import {
  generateChangelog,
  readChangesets,
  t,
  ui,
  writeChangelogToFile,
} from "@pubm/core";
import type { Command } from "commander";

export interface ChangelogCommandOptions {
  dryRun?: boolean;
  version?: string;
}

export function runChangelogCommand(
  cwd: string,
  options: ChangelogCommandOptions,
): string | null {
  const changesets = readChangesets(cwd);
  if (changesets.length === 0) return null;

  const versionHeader = options.version ?? "Unreleased";

  // Collect entries, deduplicating by changeset id to avoid duplicates
  // when a changeset targets multiple packages
  const seen = new Set<string>();
  const entries: ChangelogEntry[] = [];
  for (const changeset of changesets) {
    if (seen.has(changeset.id)) continue;
    seen.add(changeset.id);

    // Use the highest bump type from the changeset's releases
    const maxType = changeset.releases.reduce(
      (max, r) => {
        const order = { patch: 0, minor: 1, major: 2 };
        return order[r.type] > order[max] ? r.type : max;
      },
      "patch" as ChangelogEntry["type"],
    );

    entries.push({
      summary: changeset.summary,
      type: maxType,
      id: changeset.id,
    });
  }

  const content = generateChangelog(versionHeader, entries);

  if (!options.dryRun) {
    writeChangelogToFile(cwd, content);
  }

  return content;
}

export function registerChangelogCommand(parent: Command): void {
  parent
    .command("changelog")
    .description(t("cmd.changelog.description"))
    .option("--dry-run", t("cmd.changelog.optionDryRun"))
    .option("--version <ver>", t("cmd.changelog.optionVersion"))
    .action((options: { dryRun?: boolean; version?: string }) => {
      const result = runChangelogCommand(process.cwd(), options);

      if (!result) {
        ui.info(t("cmd.changelog.noChangesets"));
        return;
      }

      console.log(result);

      if (!options.dryRun) {
        ui.success(t("cmd.changelog.written"));
      }
    });
}
