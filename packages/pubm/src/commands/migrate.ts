import path from "node:path";
import type { MigrationSourceName } from "@pubm/core";
import {
  changesetsAdapter,
  consoleError,
  detectMigrationSources,
  executeMigration,
  npAdapter,
  releaseItAdapter,
  semanticReleaseAdapter,
  t,
  ui,
} from "@pubm/core";
import type { Command } from "commander";

const ALL_ADAPTERS = [
  semanticReleaseAdapter,
  releaseItAdapter,
  changesetsAdapter,
  npAdapter,
];

const VALID_SOURCES = ["semantic-release", "release-it", "changesets", "np"];

export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description(t("cmd.migrate.description"))
    .option("--from <source>", t("cmd.migrate.optionFrom"))
    .option("--clean", t("cmd.migrate.optionClean"))
    .option("-d, --dry-run", t("cli.option.dryRun"))
    .action(
      async (options: { from?: string; clean?: boolean; dryRun?: boolean }) => {
        try {
          const cwd = process.cwd();
          const isTty = process.stdout.isTTY;

          if (
            options.from !== undefined &&
            !VALID_SOURCES.includes(options.from)
          ) {
            ui.error(
              `Invalid source "${options.from}". Valid options: ${VALID_SOURCES.join(", ")}`,
            );
            process.exitCode = 1;
            return;
          }

          if (!isTty && !options.dryRun) {
            ui.error(t("cmd.migrate.ciNonTty"));
            process.exitCode = 1;
            return;
          }

          ui.info(t("cmd.migrate.scanning"));
          const detected = await detectMigrationSources(
            cwd,
            ALL_ADAPTERS,
            options.from as MigrationSourceName | undefined,
          );

          if (detected.length === 0) {
            ui.error(t("cmd.migrate.noSource"));
            process.exitCode = 1;
            return;
          }

          let selected = detected[0];
          if (detected.length > 1) {
            ui.info(t("cmd.migrate.detectedMultiple"));
            for (let i = 0; i < detected.length; i++) {
              const d = detected[i];
              const files = d.result.configFiles.map((f) =>
                path.relative(cwd, f),
              );
              console.log(
                `    ${i + 1}. ${d.adapter.name} (${files.join(", ")})`,
              );
            }
            selected = detected[0];
          }

          ui.success(
            t("cmd.migrate.detected", { source: selected.adapter.name }),
          );

          const result = await executeMigration({
            adapter: selected.adapter,
            detected: selected.result,
            cwd,
            dryRun: options.dryRun ?? false,
            clean: options.clean ?? false,
          });

          if (result.warnings.length > 0) {
            console.log();
            ui.hint(t("cmd.migrate.warningsTitle"));
            for (const warning of result.warnings) {
              console.log(`    • ${warning}`);
            }
          }

          if (result.ciAdvice.length > 0) {
            console.log();
            ui.info(t("cmd.migrate.ciAdvice"));
            for (const advice of result.ciAdvice) {
              const relFile = path.relative(cwd, advice.file);
              console.log(`    ${relFile}`);
              console.log(`      - ${advice.removeLine}`);
              console.log(`      + ${advice.addLine}`);
            }
          }

          console.log();
          if (options.dryRun) {
            ui.hint(t("cmd.migrate.dryRun"));
          } else {
            ui.success(t("cmd.migrate.complete"));
          }
        } catch (e) {
          consoleError(e as Error);
          process.exitCode = 1;
        }
      },
    );
}
