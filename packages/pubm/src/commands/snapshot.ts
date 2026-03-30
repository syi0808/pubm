import type { ResolvedPubmConfig } from "@pubm/core";
import {
  consoleError,
  createContext,
  resolveOptions,
  runSnapshotPipeline,
  t,
} from "@pubm/core";
import type { Command } from "commander";

interface SnapshotCliOptions {
  filter?: string[];
  dryRun?: boolean;
  tests: boolean;
  build: boolean;
  branch: string;
  anyBranch?: boolean;
  testScript: string;
  buildScript: string;
}

export function registerSnapshotCommand(
  program: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  program
    .command("snapshot")
    .description(t("cmd.snapshot.description"))
    .argument("[tag]", t("cmd.snapshot.tagArg"), "snapshot")
    .option(
      "-f, --filter <name>",
      t("cmd.snapshot.optionFilter"),
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option("-d, --dry-run", t("cli.option.dryRun"))
    .option("--no-tests", t("cli.option.noTests"))
    .option("--no-build", t("cli.option.noBuild"))
    .option("-b, --branch <name>", t("cli.option.branch"), "main")
    .option("-a, --any-branch", t("cli.option.anyBranch"))
    .option("--test-script <script>", t("cli.option.testScript"), "test")
    .option("--build-script <script>", t("cli.option.buildScript"), "build")
    .action(async (tag: string, options: SnapshotCliOptions) => {
      try {
        const config = getConfig();
        const resolvedOpts = resolveOptions({
          testScript: options.testScript,
          buildScript: options.buildScript,
          mode: "local",
          branch: options.branch,
          anyBranch: options.anyBranch,
          dryRun: options.dryRun,
          tag: "latest",
          saveToken: true,
          skipTests: !options.tests,
          skipBuild: !options.build,
        });

        const ctx = createContext(config, resolvedOpts, process.cwd());

        await runSnapshotPipeline(ctx, {
          tag,
          filter:
            options.filter && options.filter.length > 0
              ? options.filter
              : undefined,
          dryRun: options.dryRun,
          skipTests: !options.tests,
          skipBuild: !options.build,
        });
      } catch (e) {
        consoleError(e as Error);
        process.exitCode = 1;
      }
    });
}
