import type { ResolvedPubmConfig } from "@pubm/core";
import { consoleError, inspectPackages } from "@pubm/core";
import type { Command } from "commander";

export function registerInspectCommand(
  parent: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  const inspect = parent
    .command("inspect")
    .description("Inspect project configuration");

  inspect
    .command("packages")
    .description("Show detected packages and registries")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const config = getConfig();
        const result = inspectPackages(config, process.cwd());

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Ecosystem: ${result.ecosystem}`);

        const workspaceLabel = result.workspace.monorepo
          ? `${result.workspace.type} (monorepo)`
          : result.workspace.type;
        console.log(`Workspace: ${workspaceLabel}`);

        if (result.packages.length === 0) {
          console.log("\nNo publishable packages found.");
          return;
        }

        console.log("\nPackages:");
        for (const pkg of result.packages) {
          console.log(
            `  ${pkg.name} (${pkg.version}) → ${pkg.registries.join(", ")}`,
          );
        }
      } catch (e) {
        consoleError(e as Error);
        process.exitCode = 1;
      }
    });
}
