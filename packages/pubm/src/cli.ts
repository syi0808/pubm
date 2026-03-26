import { Reporter } from "@cluvo/sdk";
import type { Options, ResolvedPubmConfig } from "@pubm/core";
import {
  calculateVersionBumps,
  consoleError,
  createContext,
  getStatus,
  loadConfig,
  notifyNewVersion,
  PUBM_VERSION,
  pubm,
  requiredMissingInformationTasks,
  resolveConfig,
  resolveOptions,
  resolvePhases,
  ui,
  validateOptions,
} from "@pubm/core";
import { Command } from "commander";
import semver from "semver";
import { isCI } from "std-env";
import { registerChangesetsCommand } from "./commands/changesets.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerSecretsCommand } from "./commands/secrets.js";
import { registerSetupSkillsCommand } from "./commands/setup-skills.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerVersionCommand } from "./commands/version-cmd.js";
import { showSplash } from "./splash.js";

const { RELEASE_TYPES } = semver;

/* istanbul ignore next -- IIFE bootstrap: covered by e2e tests */
const reporter = new Reporter({
  repo: "syi0808/pubm",
  app: { name: "pubm", version: PUBM_VERSION },
  prompt: { spacing: 0 },
});

interface CliOptions {
  version: string;
  testScript: string;
  buildScript: string;
  mode?: string;
  phase?: string;
  dryRun?: boolean;
  releaseDraft?: boolean;
  branch: string;
  anyBranch?: boolean;
  preCheck: boolean;
  conditionCheck: boolean;
  tests: boolean;
  build: boolean;
  publish: boolean;
  snapshot?: string | boolean;
  skipRelease?: boolean;
  tag: string;
  contents?: string;
  registry?: string;
  saveToken: boolean;
  dangerouslyAllowUnpublish?: boolean;
}

type ResolvedCliOptionsInput = Omit<CliOptions, "version">;
type ResolvedCliMode = Options["mode"];

function resolveCliMode(mode?: string): ResolvedCliMode {
  return mode === "ci" ? "ci" : "local";
}

export function resolveCliOptions(
  options: ResolvedCliOptionsInput,
): Partial<Options> {
  return {
    testScript: options.testScript,
    buildScript: options.buildScript,
    mode: resolveCliMode(options.mode),
    prepare: options.phase === "prepare" ? true : undefined,
    publish: options.phase === "publish" ? true : undefined,
    dryRun: options.dryRun,
    releaseDraft: options.releaseDraft,
    branch: options.branch,
    anyBranch: options.anyBranch,
    skipPublish: !options.publish,
    skipReleaseDraft: !!options.skipRelease,
    skipTests: !options.tests,
    skipBuild: !options.build,
    skipPrerequisitesCheck: !options.preCheck,
    skipConditionsCheck: !options.conditionCheck,
    snapshot: options.snapshot,
    tag: options.tag,
    contents: options.contents,
    saveToken: options.saveToken,
  };
}

let resolvedConfig: ResolvedPubmConfig;

export function createProgram(): Command {
  const program = new Command("pubm");

  program.description("Publish packages to registries");
  program.version(PUBM_VERSION);
  program.enablePositionalOptions();
  program.option("--no-color", "Disable colored output");
  program.option("--config <path>", "Path to config file");
  program.hook("preAction", (thisCommand) => {
    if (!thisCommand.opts().color) {
      process.env.NO_COLOR = "1";
      ui.chalk.level = 0;
    }
  });

  // Register subcommands
  registerChangesetsCommand(program, () => resolvedConfig);
  registerInitCommand(program);
  registerSetupSkillsCommand(program);
  registerUpdateCommand(program);
  registerSecretsCommand(program);
  registerSyncCommand(program);
  registerVersionCommand(program, () => resolvedConfig);
  registerInspectCommand(program, () => resolvedConfig);

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
    .option("--mode <mode>", "Release mode: local (default) or ci")
    .option(
      "--phase <phase>",
      "Pipeline phase: prepare or publish (local mode runs both by default)",
    )
    .option(
      "-d, --dry-run",
      "Validate without side effects (version bump rolls back, publish uses registry dry-run)",
    )
    .option("--release-draft", "Create GitHub Release as draft (not published)")
    .option("-b, --branch <name>", "Name of the release branch", "main")
    .option("-a, --any-branch", "Allow publishing from any branch")
    .option("--no-pre-check", "Skip prerequisites check task")
    .option("--no-condition-check", "Skip required conditions check task")
    .option("--no-tests", "Skip running tests before publishing")
    .option("--no-build", "Skip build before publishing")
    .option("--no-publish", "Skip publishing task")
    .option("--skip-release", "Skip GitHub Release creation")
    .option(
      "--snapshot [tag]",
      "Publish a temporary snapshot version (default tag: snapshot)",
    )
    .option("-t, --tag <name>", "Publish under a specific dist-tag", "latest")
    .option("-c, --contents <path>", "Subdirectory to publish")
    .option(
      "--no-save-token",
      "Do not save jsr tokens (request the token each time)",
    )
    .option(
      "--dangerously-allow-unpublish",
      "Allow registry unpublish/yank during rollback in non-TTY environments",
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

        const cliOptions = resolveOptions(resolveCliOptions(options));
        validateOptions(cliOptions);

        if (!isCI && process.stderr.isTTY) {
          showSplash(PUBM_VERSION);
        }

        if (!isCI) {
          await notifyNewVersion();
        }

        const ctx = createContext(resolvedConfig, cliOptions, process.cwd());

        // CLI override for dangerouslyAllowUnpublish
        if (options.dangerouslyAllowUnpublish) {
          ctx.config = Object.freeze({
            ...ctx.config,
            rollback: {
              ...ctx.config.rollback,
              dangerouslyAllowUnpublish: true,
            },
          });
        }

        if (nextVersion) {
          if (resolvedConfig.packages.length <= 1) {
            ctx.runtime.versionPlan = {
              mode: "single",
              version: nextVersion,
              packagePath: resolvedConfig.packages[0]?.path ?? ".",
            };
          } else {
            const packages = new Map(
              resolvedConfig.packages.map((p) => [p.path, nextVersion]),
            );
            ctx.runtime.versionPlan = {
              mode: "fixed",
              version: nextVersion,
              packages,
            };
          }
        }
        ctx.runtime.tag = options.tag;

        if (options.snapshot) {
          const snapshotTag =
            typeof options.snapshot === "string"
              ? options.snapshot
              : "snapshot";

          ctx.runtime.versionPlan = {
            mode: "single",
            version: "snapshot",
            packagePath: resolvedConfig.packages[0]?.path ?? ".",
          };
          ctx.runtime.tag = snapshotTag;
          await pubm(ctx);
          return;
        }

        try {
          const mode = cliOptions.mode ?? "local";
          const phases = resolvePhases(cliOptions);

          if (mode === "ci" && phases.includes("prepare")) {
            // CI prepare: collect tokens interactively, then run pipeline
            await requiredMissingInformationTasks().run(ctx);
          } else if (mode === "ci" && phases.includes("publish")) {
            // CI publish: read version from package.json
            if (resolvedConfig.packages.length <= 1) {
              const pkg = resolvedConfig.packages[0];
              const version = pkg?.version ?? "";
              ctx.runtime.versionPlan = {
                mode: "single",
                version,
                packagePath: pkg?.path ?? ".",
              };
            } else if (resolvedConfig.versioning === "independent") {
              const packages = new Map(
                resolvedConfig.packages.map((p) => [p.path, p.version]),
              );
              ctx.runtime.versionPlan = {
                mode: "independent",
                packages,
              };
            } else {
              const packages = new Map(
                resolvedConfig.packages.map((p) => [p.path, p.version]),
              );
              const version = [...packages.values()][0];
              ctx.runtime.versionPlan = {
                mode: "fixed",
                version,
                packages,
              };
            }
          } else if (
            mode === "local" &&
            phases.includes("publish") &&
            !phases.includes("prepare")
          ) {
            // Local publish-only: read version from package.json (same as old --publish-only)
            if (resolvedConfig.packages.length <= 1) {
              const pkg = resolvedConfig.packages[0];
              const version = pkg?.version ?? "";
              ctx.runtime.versionPlan = {
                mode: "single",
                version,
                packagePath: pkg?.path ?? ".",
              };
            } else if (resolvedConfig.versioning === "independent") {
              const packages = new Map(
                resolvedConfig.packages.map((p) => [p.path, p.version]),
              );
              ctx.runtime.versionPlan = {
                mode: "independent",
                packages,
              };
            } else {
              const packages = new Map(
                resolvedConfig.packages.map((p) => [p.path, p.version]),
              );
              const version = [...packages.values()][0];
              ctx.runtime.versionPlan = {
                mode: "fixed",
                version,
                packages,
              };
            }
          } else if (isCI && mode === "local") {
            // Backward compatibility: isCI detected but --mode not set
            const status = getStatus(process.cwd());
            if (status.hasChangesets) {
              const currentVersions = new Map(
                resolvedConfig.packages.map((p) => [p.name, p.version]),
              );
              const bumps = calculateVersionBumps(
                currentVersions,
                process.cwd(),
              );

              if (bumps.size > 0) {
                if (bumps.size === 1) {
                  const [name, bump] = [...bumps][0];
                  const pkg = resolvedConfig.packages.find(
                    (p) => p.name === name,
                  );
                  ctx.runtime.versionPlan = {
                    mode: "single",
                    version: bump.newVersion,
                    packagePath: pkg?.path ?? ".",
                  };
                } else {
                  const bumpedPackages = new Map(
                    [...bumps].map(([name, bump]) => [
                      resolvedConfig.packages.find((p) => p.name === name)
                        ?.path ?? name,
                      bump.newVersion,
                    ]),
                  );
                  const allSame = new Set(bumpedPackages.values()).size === 1;
                  const versioningMode =
                    resolvedConfig.versioning ??
                    (allSame ? "fixed" : "independent");
                  if (versioningMode === "fixed") {
                    ctx.runtime.versionPlan = {
                      mode: "fixed",
                      version: [...bumpedPackages.values()][0],
                      packages: bumpedPackages,
                    };
                  } else {
                    ctx.runtime.versionPlan = {
                      mode: "independent",
                      packages: bumpedPackages,
                    };
                  }
                }
                ctx.runtime.changesetConsumed = true;
                ui.info("Changesets detected:");
                for (const [name, bump] of bumps) {
                  console.log(
                    `  ${name}: ${bump.currentVersion} → ${bump.newVersion} (${bump.bumpType})`,
                  );
                }
              }
            }

            if (!ctx.runtime.versionPlan) {
              throw new Error(
                "Version must be set in the CI environment. Please define the version before proceeding.",
              );
            }
          } else {
            // Local mode: interactive prompts
            await requiredMissingInformationTasks().run(ctx);
          }

          await pubm(ctx);
        } catch (e) {
          consoleError(e as Error);

          await reporter.reportError(e);

          process.exitCode = 1;
        }
      },
    );

  program.addHelpText("after", () => {
    return `\n  Version can be:\n    ${RELEASE_TYPES.join(" | ")} | 1.2.3\n`;
  });

  return program;
}

await reporter.wrapCommand(async () => {
  const program = createProgram();
  const cwd = process.cwd();

  // Extract --config from argv before full parse
  const configArgIndex = process.argv.indexOf("--config");
  const configPath =
    configArgIndex !== -1 ? process.argv[configArgIndex + 1] : undefined;

  // Single config load + resolve for entire CLI session
  const raw = await loadConfig(cwd, configPath);
  const config = await resolveConfig(raw ?? {}, cwd);

  // Register plugin commands
  for (const plugin of config.plugins) {
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

  // Make config available to action callbacks
  resolvedConfig = config;

  await program.parseAsync();
});

reporter.installGlobalHandlers();
reporter.installExitHandler();
