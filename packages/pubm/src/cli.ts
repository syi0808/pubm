import type { Options, ResolvedPubmConfig } from "@pubm/core";
import {
  calculateVersionBumps,
  consoleError,
  createContext,
  Git,
  getStatus,
  loadConfig,
  notifyNewVersion,
  PUBM_VERSION,
  pubm,
  requiredMissingInformationTasks,
  resolveConfig,
  resolveOptions,
} from "@pubm/core";
import { Command } from "commander";
import semver from "semver";
import { isCI } from "std-env";
import { registerChangesetsCommand } from "./commands/changesets.js";
import { registerInitCommand } from "./commands/init.js";
import { registerSecretsCommand } from "./commands/secrets.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerVersionCommand } from "./commands/version-cmd.js";
import { showSplash } from "./splash.js";

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
  snapshot?: string | boolean;
  releaseDraft: boolean;
  tag: string;
  contents?: string;
  registry?: string;
  saveToken: boolean;
}

export function resolveCliOptions(
  options: Omit<CliOptions, "version">,
): Partial<Options> {
  return {
    testScript: (options as any).testScript,
    buildScript: (options as any).buildScript,
    preview: options.preview,
    branch: options.branch,
    anyBranch: options.anyBranch,
    skipPublish: !options.publish,
    skipReleaseDraft: !options.releaseDraft,
    skipTests: !options.tests,
    skipBuild: !options.build,
    skipPrerequisitesCheck: !options.preCheck,
    skipConditionsCheck: !options.conditionCheck,
    preflight: options.preflight,
    ci: options.ci,
    snapshot: options.snapshot,
    tag: options.tag,
    contents: options.contents,
    saveToken: options.saveToken,
    publishOnly: options.publishOnly,
  };
}

let resolvedConfig: ResolvedPubmConfig;

export function createProgram(): Command {
  const program = new Command("pubm");

  program.description("Publish packages to registries");
  program.version(PUBM_VERSION);

  // Register subcommands
  registerChangesetsCommand(program, () => resolvedConfig);
  registerInitCommand(program);
  registerUpdateCommand(program);
  registerSecretsCommand(program);
  registerSyncCommand(program);
  registerVersionCommand(program, () => resolvedConfig);

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

        if (options.snapshot && options.preflight) {
          throw new Error("Cannot use --snapshot and --preflight together.");
        }

        if (!isCI && process.stderr.isTTY) {
          showSplash(PUBM_VERSION);
        }

        if (!isCI) {
          await notifyNewVersion();
        }

        const cliOptions = resolveOptions(resolveCliOptions(options));
        const ctx = createContext(resolvedConfig, cliOptions, process.cwd());

        if (nextVersion) {
          ctx.runtime.version = nextVersion;
        }
        ctx.runtime.tag = options.tag;

        if (options.snapshot) {
          const snapshotTag =
            typeof options.snapshot === "string"
              ? options.snapshot
              : "snapshot";

          ctx.runtime.version = "snapshot";
          ctx.runtime.tag = snapshotTag;
          await pubm(ctx);
          return;
        }

        try {
          if (options.preflight) {
            await requiredMissingInformationTasks().run(ctx);
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

              ctx.runtime.version = latestVersion;
            } else {
              // Check for pending changesets in CI
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
                    // Single package
                    const [, bump] = [...bumps][0];
                    ctx.runtime.version = bump.newVersion;
                  } else {
                    // Multi-package
                    ctx.runtime.versions = new Map(
                      [...bumps].map(([name, bump]) => [name, bump.newVersion]),
                    );
                    // For fixed mode, also set ctx.runtime.version to the shared version
                    if (resolvedConfig.versioning === "fixed") {
                      ctx.runtime.version = [...bumps.values()][0].newVersion;
                    } else {
                      // Independent mode: use first version as fallback for required version field
                      ctx.runtime.version = [...bumps.values()][0].newVersion;
                    }
                  }
                  ctx.runtime.changesetConsumed = true;

                  console.log("Changesets detected:");
                  for (const [name, bump] of bumps) {
                    console.log(
                      `  ${name}: ${bump.currentVersion} → ${bump.newVersion} (${bump.bumpType})`,
                    );
                  }
                }
              }

              if (!ctx.runtime.version && !ctx.runtime.versions) {
                throw new Error(
                  "Version must be set in the CI environment. Please define the version before proceeding.",
                );
              }
            }
          } else {
            await requiredMissingInformationTasks().run(ctx);
          }

          await pubm(ctx);
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
  const cwd = process.cwd();

  // Single config load + resolve for entire CLI session
  const raw = await loadConfig(cwd);
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
})();
