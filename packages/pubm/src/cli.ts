import type {
  Options,
  PubmContext,
  ResolvedPubmConfig,
  VersionPlan,
  VersionRecommendation,
  VersionSource,
  VersionSourceContext,
} from "@pubm/core";
import {
  ChangesetSource,
  ConventionalCommitSource,
  consoleError,
  createContext,
  initI18n,
  loadConfig,
  mergeRecommendations,
  notifyNewVersion,
  PUBM_VERSION,
  packageKey,
  pubm,
  requiredMissingInformationTasks,
  resolveConfig,
  resolveOptions,
  resolvePhases,
  t,
  ui,
  validateOptions,
} from "@pubm/core";
import { Command } from "commander";
import semver from "semver";
import { isCI } from "std-env";
import { registerChangesetsCommand } from "./commands/changesets.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { registerSecretsCommand } from "./commands/secrets.js";
import { registerSetupSkillsCommand } from "./commands/setup-skills.js";
import { registerSnapshotCommand } from "./commands/snapshot.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerVersionCommand } from "./commands/version-cmd.js";
import { showSplash } from "./splash.js";

declare const __PUBM_DEV__: boolean;

const { RELEASE_TYPES } = semver;

/* istanbul ignore next -- compile-time constant */
const isDev = typeof __PUBM_DEV__ === "boolean" ? __PUBM_DEV__ : true;

/* istanbul ignore next -- IIFE bootstrap: covered by e2e tests */
const reporter = isDev
  ? new (await import("@cluvo/sdk")).Reporter({
      repo: "syi0808/pubm",
      app: { name: "pubm", version: PUBM_VERSION },
      prompt: { spacing: 0 },
    })
  : undefined;

interface CliOptions {
  version: string;
  testScript: string;
  buildScript: string;
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
  skipRelease?: boolean;
  tag: string;
  contents?: string;
  registry?: string;
  saveToken: boolean;
  dryRunValidation: boolean;
  dangerouslyAllowUnpublish?: boolean;
  createPr?: boolean;
  locale?: string;
}

type ResolvedCliOptionsInput = Omit<CliOptions, "version">;

export function resolveCliOptions(
  options: ResolvedCliOptionsInput,
): Partial<Options> {
  return {
    testScript: options.testScript,
    buildScript: options.buildScript,
    phase: options.phase as Options["phase"] | undefined,
    dryRun: options.dryRun,
    releaseDraft: options.releaseDraft,
    branch: options.branch,
    anyBranch: options.anyBranch,
    skipPublish: !options.publish,
    skipReleaseDraft: !!options.skipRelease,
    skipTests: !options.tests,
    skipBuild: !options.build,
    skipDryRun: !options.dryRunValidation,
    skipPrerequisitesCheck: !options.preCheck,
    skipConditionsCheck: !options.conditionCheck,
    tag: options.tag,
    contents: options.contents,
    saveToken: options.saveToken,
    createPr: options.createPr,
  };
}

let resolvedConfig: ResolvedPubmConfig;

function createVersionPlanFromManifests(
  config: ResolvedPubmConfig,
): VersionPlan {
  if (config.packages.length <= 1) {
    const pkg = config.packages[0];
    const version = pkg?.version ?? "";
    return {
      mode: "single",
      version,
      packageKey: pkg ? packageKey(pkg) : ".",
    };
  }

  const packages = new Map(
    config.packages.map((pkg) => [packageKey(pkg), pkg.version]),
  );

  if (config.versioning === "independent") {
    return {
      mode: "independent",
      packages,
    };
  }

  return {
    mode: "fixed",
    version: [...packages.values()][0],
    packages,
  };
}

async function applyVersionSourcePlan(
  ctx: PubmContext,
  config: ResolvedPubmConfig,
): Promise<void> {
  const currentVersions = new Map(
    config.packages.map((pkg) => [pkg.path, pkg.version]),
  );

  const sources: VersionSource[] = [];
  const versionSources = config.versionSources ?? "all";
  if (versionSources === "all" || versionSources === "changesets") {
    sources.push(new ChangesetSource());
  }
  if (versionSources === "all" || versionSources === "commits") {
    sources.push(
      new ConventionalCommitSource(config.conventionalCommits?.types),
    );
  }

  const vsContext: VersionSourceContext = {
    cwd: process.cwd(),
    packages: currentVersions,
  };
  const sourceResults: VersionRecommendation[][] = [];
  for (const source of sources) {
    sourceResults.push(await source.analyze(vsContext));
  }
  const recommendations = mergeRecommendations(sourceResults);

  if (recommendations.length === 0) return;

  const packages = new Map<string, string>();
  for (const rec of recommendations) {
    const matchingPkgs = config.packages.filter(
      (pkg) => pkg.path === rec.packagePath,
    );
    for (const pkg of matchingPkgs) {
      const newVersion = semver.inc(pkg.version, rec.bumpType);
      if (newVersion) {
        packages.set(packageKey(pkg), newVersion);
      }
    }
  }

  if (packages.size === 1) {
    const [key, version] = [...packages.entries()][0];
    ctx.runtime.versionPlan = {
      mode: "single",
      version,
      packageKey: key,
    };
  } else if (packages.size > 1) {
    ctx.runtime.versionPlan =
      config.versioning === "fixed"
        ? {
            mode: "fixed",
            version: [...packages.values()][0],
            packages,
          }
        : { mode: "independent", packages };
  }

  const hasChangesetSource = recommendations.some(
    (rec) => rec.source === "changeset",
  );
  if (hasChangesetSource) {
    ctx.runtime.changesetConsumed = true;
  }
}

/* istanbul ignore next -- argv parsing for early locale init before Commander parses */
function parseArgvForLocale(argv: string[]): string | undefined {
  const idx = argv.indexOf("--locale");
  return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
}

export function createProgram(config?: ResolvedPubmConfig): Command {
  if (config) {
    resolvedConfig = config;
  }

  const program = new Command("pubm");

  program.description(t("cli.description"));
  program.version(PUBM_VERSION);
  program.enablePositionalOptions();
  program.option("--no-color", t("cli.option.noColor"));
  program.option("--config <path>", t("cli.option.config"));
  program.option("--locale <locale>", t("cli.option.locale"));
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
  registerSnapshotCommand(program, () => resolvedConfig);
  registerMigrateCommand(program);

  // Default command: publish (backward compatible with `pubm [version]`)
  program
    .argument(
      "[version]",
      t("cli.argument.version", { types: RELEASE_TYPES.join(" | ") }),
    )
    .option("--test-script <script>", t("cli.option.testScript"), "test")
    .option("--build-script <script>", t("cli.option.buildScript"), "build")
    .option("--phase <phase>", t("cli.option.phase"))
    .option("-d, --dry-run", t("cli.option.dryRun"))
    .option("--release-draft", t("cli.option.releaseDraft"))
    .option("-b, --branch <name>", t("cli.option.branch"), "main")
    .option("-a, --any-branch", t("cli.option.anyBranch"))
    .option("--no-pre-check", t("cli.option.noPreCheck"))
    .option("--no-condition-check", t("cli.option.noConditionCheck"))
    .option("--no-tests", t("cli.option.noTests"))
    .option("--no-build", t("cli.option.noBuild"))
    .option("--no-publish", t("cli.option.noPublish"))
    .option("--no-dry-run-validation", t("cli.option.noDryRunValidation"))
    .option("--skip-release", t("cli.option.skipRelease"))
    .option("-t, --tag <name>", t("cli.option.tag"), "latest")
    .option("-c, --contents <path>", t("cli.option.contents"))
    .option("--no-save-token", t("cli.option.noSaveToken"))
    .option(
      "--dangerously-allow-unpublish",
      t("cli.option.dangerouslyAllowUnpublish"),
    )
    .option("--create-pr", t("cli.option.createPr"))
    .option("--registry <registries>", t("cli.option.registry"))
    .action(
      async (
        nextVersion: string | undefined,
        options: Omit<CliOptions, "version">,
      ): Promise<void> => {
        console.clear();

        const rawCliOpts = resolveCliOptions(options);
        if (!rawCliOpts.skipDryRun && resolvedConfig.skipDryRun) {
          rawCliOpts.skipDryRun = true;
        }
        const cliOptions = resolveOptions(rawCliOpts);
        validateOptions(cliOptions);

        if (!isCI && process.stderr.isTTY) {
          showSplash(PUBM_VERSION);
        }

        if (!isCI) {
          await notifyNewVersion();
        }

        const ctx = createContext(resolvedConfig, cliOptions, process.cwd());

        // CLI override for --registry: filter package registries
        if (options.registry) {
          const allowed = new Set(
            options.registry.split(",").map((r) => r.trim()),
          );
          ctx.config = Object.freeze({
            ...ctx.config,
            packages: ctx.config.packages.map((pkg) => ({
              ...pkg,
              registries: pkg.registries.filter((r) => allowed.has(r)),
            })),
          });
        }

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
            const pkg0 = resolvedConfig.packages[0];
            ctx.runtime.versionPlan = {
              mode: "single",
              version: nextVersion,
              packageKey: pkg0 ? packageKey(pkg0) : ".",
            };
          } else {
            const packages = new Map(
              resolvedConfig.packages.map((p) => [packageKey(p), nextVersion]),
            );
            ctx.runtime.versionPlan = {
              mode: "fixed",
              version: nextVersion,
              packages,
            };
          }
        }
        ctx.runtime.tag = options.tag;

        try {
          resolvePhases(cliOptions);
          const phase = cliOptions.phase;

          if (phase === "publish") {
            ctx.runtime.versionPlan =
              createVersionPlanFromManifests(resolvedConfig);
          } else if (isCI && phase === undefined) {
            if (!nextVersion) {
              await applyVersionSourcePlan(ctx, resolvedConfig);
              if (!ctx.runtime.versionPlan) {
                throw new Error(t("error.cli.versionRequired"));
              }
            }
          } else {
            await requiredMissingInformationTasks().run(ctx);
          }

          await pubm(ctx);
        } catch (e) {
          consoleError(e as Error);

          if (reporter) await reporter.reportError(e);

          process.exitCode = 1;
        }
      },
    );

  program.addHelpText("after", () => {
    return t("cli.helpText.version", { types: RELEASE_TYPES.join(" | ") });
  });

  return program;
}

/* istanbul ignore next -- IIFE bootstrap: covered by e2e tests */
const bootstrap = async () => {
  // Early locale init so Commander help text can be translated
  initI18n({ flag: parseArgvForLocale(process.argv) });

  const program = createProgram();
  const cwd = process.cwd();

  // Extract --config from argv before full parse
  const configArgIndex = process.argv.indexOf("--config");
  const configPath =
    configArgIndex !== -1 ? process.argv[configArgIndex + 1] : undefined;

  // Single config load + resolve for entire CLI session
  const raw = await loadConfig(cwd, configPath);
  const config = await resolveConfig(raw ?? {}, cwd);

  // Full locale init with config-level locale override
  initI18n({
    flag: parseArgvForLocale(process.argv),
    configLocale: config?.locale,
  });

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
};

if (reporter) {
  await reporter.wrapCommand(bootstrap);
  reporter.installGlobalHandlers();
  reporter.installExitHandler();
} else {
  await bootstrap();
}
