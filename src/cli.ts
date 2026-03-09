import { Command } from "commander";
import semver from "semver";
import { isCI } from "std-env";
import { registerChangesetsCommand } from "./commands/changesets.js";
import { registerInitCommand } from "./commands/init.js";
import { registerSecretsCommand } from "./commands/secrets.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerUpdateCommand } from "./commands/update.js";
import { loadConfig } from "./config/loader.js";
import { consoleError } from "./error.js";
import { Git } from "./git.js";
import { pubm } from "./index.js";
import { requiredMissingInformationTasks } from "./tasks/required-missing-information.js";
import type { Options } from "./types/options.js";
import { notifyNewVersion } from "./utils/notify-new-version.js";
import { version } from "./utils/package.js";

const { RELEASE_TYPES, valid } = semver;

interface CliOptions {
  version: string;
  testScript: string;
  preview?: boolean;
  branch: string;
  anyBranch?: boolean;
  preCheck: boolean;
  conditionCheck: boolean;
  tests: boolean;
  build: boolean;
  publish: boolean;
  publishOnly: boolean;
  ci?: boolean;
  preflight?: boolean;
  releaseDraft: boolean;
  tag: string;
  contents?: string;
  registry?: string;
  saveToken: boolean;
}

export function resolveCliOptions(options: CliOptions): Options {
  return {
    ...options,
    skipPublish: !options.publish,
    skipReleaseDraft: !options.releaseDraft,
    skipTests: !options.tests,
    skipBuild: !options.build,
    registries: options.registry?.split(","),
    skipPrerequisitesCheck: !options.preCheck,
    skipConditionsCheck: !options.conditionCheck,
    preflight: options.preflight,
    ci: options.ci,
  };
}

export function createProgram(): Command {
  const program = new Command("pubm");

  program.description("Publish packages to registries");

  // Register subcommands
  registerChangesetsCommand(program);
  registerInitCommand(program);
  registerUpdateCommand(program);
  registerSecretsCommand(program);
  registerSyncCommand(program);

  // Default command: publish (backward compatible with `pubm [version]`)
  program
    .argument("[version]", `Version: ${RELEASE_TYPES.join(" | ")} | 1.2.3`)
    .option(
      "--test-script <script>",
      "The npm script to run tests before publishing",
      "test",
    )
    .option(
      "--build-script <script>",
      "The npm script to run build before publishing",
      "build",
    )
    .option("-p, --preview", "Show tasks without actually executing publish")
    .option("-b, --branch <name>", "Name of the release branch", "main")
    .option("-a, --any-branch", "Allow publishing from any branch")
    .option("--no-pre-check", "Skip prerequisites check task")
    .option("--no-condition-check", "Skip required conditions check task")
    .option("--no-tests", "Skip running tests before publishing")
    .option("--no-build", "Skip build before publishing")
    .option("--no-publish", "Skip publishing task")
    .option("--no-release-draft", "Skip creating a GitHub release draft")
    .option("--publish-only", "Run only publish task for latest tag")
    .option(
      "--ci",
      "CI mode: publish from latest tag and create GitHub Release with assets",
    )
    .option(
      "--preflight",
      "Simulate CI publish locally (dry-run with token-based auth)",
    )
    .option("-t, --tag <name>", "Publish under a specific dist-tag", "latest")
    .option("-c, --contents <path>", "Subdirectory to publish")
    .option(
      "--no-save-token",
      "Do not save jsr tokens (request the token each time)",
    )
    .option(
      "--registry <registries>",
      "Target registries for publish\n        registry can be npm | jsr | https://url.for.private-registries",
      "npm,jsr",
    )
    .action(
      async (
        nextVersion: string | undefined,
        options: Omit<CliOptions, "version">,
      ): Promise<void> => {
        console.clear();

        if (!isCI) {
          await notifyNewVersion();
        }

        const context = {
          version: nextVersion,
          tag: options.tag,
        };

        try {
          if (options.preflight) {
            await requiredMissingInformationTasks().run(context);
          } else if (isCI) {
            if (options.publishOnly || options.ci) {
              const git = new Git();
              const latestVersion = (await git.latestTag())?.slice(1);

              if (!latestVersion) {
                throw new Error(
                  "Cannot find the latest tag. Please ensure tags exist in the repository.",
                );
              }

              if (!valid(latestVersion)) {
                throw new Error(
                  "Cannot parse the latest tag to a valid SemVer version. Please check the tag format.",
                );
              }

              context.version = latestVersion;
            } else {
              throw new Error(
                "Version must be set in the CI environment. Please define the version before proceeding.",
              );
            }
          } else {
            await requiredMissingInformationTasks().run(context);
          }

          await pubm(
            resolveCliOptions({
              ...options,
              version: context.version,
              tag: context.tag,
            } as CliOptions),
          );
        } catch (e) {
          consoleError(e as Error);
          process.exitCode = 1;
        }
      },
    );

  program.addHelpText("after", () => {
    return `\n  Version can be:\n    ${RELEASE_TYPES.join(" | ")} | 1.2.3\n`;
  });

  return program;
}

(async () => {
  const program = createProgram();

  // Register plugin commands before parsing
  const config = await loadConfig();
  const plugins = config?.plugins ?? [];

  for (const plugin of plugins) {
    for (const cmd of plugin.commands ?? []) {
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          const parentCmd = program
            .command(cmd.name)
            .description(cmd.description ?? "");
          const subCmd = parentCmd
            .command(sub.name)
            .description(sub.description);
          for (const opt of sub.options ?? []) {
            subCmd.option(opt.name, opt.description);
          }
          subCmd.action(sub.action);
        }
      }
    }
  }

  program.version(await version({ cwd: import.meta.dirname }));
  await program.parseAsync();
})();
