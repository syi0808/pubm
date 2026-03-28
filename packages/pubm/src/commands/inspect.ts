import type { ResolvedPubmConfig } from "@pubm/core";
import { consoleError, inspectPackages, t } from "@pubm/core";
import type { Command } from "commander";

export function registerInspectCommand(
  parent: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  const inspect = parent
    .command("inspect")
    .description(t("cmd.inspect.description"));

  inspect
    .command("packages")
    .description(t("cmd.inspect.packages"))
    .option("--json", t("cmd.inspect.optionJson"))
    .action(async (options: { json?: boolean }) => {
      try {
        const config = getConfig();
        const result = inspectPackages(config, process.cwd());

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(
          t("cmd.inspect.ecosystem", { ecosystem: result.ecosystem }),
        );

        const workspaceLabel = result.workspace.monorepo
          ? t("cmd.inspect.monorepo", { type: result.workspace.type })
          : result.workspace.type;
        console.log(`Workspace: ${workspaceLabel}`);

        if (result.packages.length === 0) {
          console.log(`\n${t("cmd.inspect.noPackages")}`);
          return;
        }

        console.log(`\n${t("cmd.inspect.packagesHeader")}`);
        for (const pkg of result.packages) {
          console.log(
            `  ${t("cmd.inspect.packageLine", { name: pkg.name, version: pkg.version, registries: pkg.registries.join(", ") })}`,
          );
        }
      } catch (e) {
        consoleError(e as Error);
        process.exitCode = 1;
      }
    });
}
