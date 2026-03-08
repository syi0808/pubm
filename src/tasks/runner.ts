import process from "node:process";
import npmCli from "@npmcli/promise-spawn";
import { color, type Listr } from "listr2";
import SemVer from "semver";
import { isCI } from "std-env";
import { exec } from "tinyexec";
import type { PackageConfig } from "../config/types.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError, consoleError } from "../error.js";
import { Git } from "../git.js";
import type { ResolvedOptions } from "../types/options.js";
import { link } from "../utils/cli.js";
import { sortCratesByDependencyOrder } from "../utils/crate-graph.js";
import { createListr } from "../utils/listr.js";
import {
  getJsrJson,
  getPackageJson,
  replaceVersion,
} from "../utils/package.js";
import { getPackageManager } from "../utils/package-manager.js";
import { collectRegistries } from "../utils/registries.js";
import {
  addRollback,
  rollback,
  rollbackError,
  rollbackLog,
} from "../utils/rollback.js";
import { injectTokensToEnv } from "../utils/token.js";
import { cratesPublishTasks, createCratesPublishTask } from "./crates.js";
import {
  cratesDryRunPublishTask,
  createCratesDryRunPublishTask,
  jsrDryRunPublishTask,
  npmDryRunPublishTask,
} from "./dry-run-publish.js";
import { jsrPublishTasks } from "./jsr.js";
import { npmPublishTasks } from "./npm.js";
import { collectTokens, promptGhSecretsSync } from "./preflight.js";
import { prerequisitesCheckTask } from "./prerequisites-check.js";
import { requiredConditionsCheckTask } from "./required-conditions-check.js";

const { open } = npmCli;
const { prerelease } = SemVer;

export interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;
  cleanWorkingTree: boolean;
}

function registryTask(registry: string) {
  switch (registry) {
    case "npm":
      return npmPublishTasks;
    case "jsr":
      return jsrPublishTasks;
    case "crates":
      return cratesPublishTasks;
    default:
      return npmPublishTasks;
  }
}

async function collectPublishTasks(ctx: Ctx) {
  if (ctx.packages?.length) {
    const nonCratesTasks = ctx.packages.flatMap((pkg: PackageConfig) =>
      pkg.registries
        .filter((reg) => reg !== "crates")
        .map((reg) => registryTask(reg)),
    );

    const cratesPaths = ctx.packages
      .filter((pkg) => pkg.registries.includes("crates"))
      .map((pkg) => pkg.path);

    if (cratesPaths.length === 0) {
      return nonCratesTasks;
    }

    const sortedPaths = await sortCratesByDependencyOrder(cratesPaths);
    const sequentialCratesTask = {
      title: "Publishing to crates.io (sequential)",
      task: (_ctx: Ctx, task: { newListr: (...args: any[]) => any }) =>
        task.newListr(
          sortedPaths.map((p) => createCratesPublishTask(p)),
          { concurrent: false },
        ),
    };

    return [...nonCratesTasks, sequentialCratesTask];
  }
  return collectRegistries(ctx).map(registryTask);
}

function dryRunRegistryTask(registry: string) {
  switch (registry) {
    case "npm":
      return npmDryRunPublishTask;
    case "jsr":
      return jsrDryRunPublishTask;
    case "crates":
      return cratesDryRunPublishTask;
    default:
      return npmDryRunPublishTask;
  }
}

async function collectDryRunPublishTasks(ctx: Ctx) {
  if (ctx.packages?.length) {
    const nonCratesTasks = ctx.packages.flatMap((pkg: PackageConfig) =>
      pkg.registries
        .filter((reg) => reg !== "crates")
        .map((reg) => dryRunRegistryTask(reg)),
    );

    const cratesPaths = ctx.packages
      .filter((pkg) => pkg.registries.includes("crates"))
      .map((pkg) => pkg.path);

    if (cratesPaths.length === 0) {
      return nonCratesTasks;
    }

    const sortedPaths = await sortCratesByDependencyOrder(cratesPaths);
    const siblingCrateNames = await Promise.all(
      cratesPaths.map((p) => new RustEcosystem(p).packageName()),
    );
    const sequentialCratesTask = {
      title: "Dry-run crates.io publish (sequential)",
      task: (_ctx: Ctx, task: { newListr: (...args: any[]) => any }) =>
        task.newListr(
          sortedPaths.map((p) =>
            createCratesDryRunPublishTask(p, siblingCrateNames),
          ),
          { concurrent: false },
        ),
    };

    return [...nonCratesTasks, sequentialCratesTask];
  }
  return collectRegistries(ctx).map(dryRunRegistryTask);
}

export async function run(options: ResolvedOptions): Promise<void> {
  const ctx = <Ctx>{
    ...options,
    promptEnabled: !isCI && process.stdin.isTTY,
  };

  let cleanupEnv: (() => void) | undefined;

  const onSigint = async () => {
    cleanupEnv?.();
    await rollback();
    process.exit(130);
  };
  process.on("SIGINT", onSigint);

  try {
    if (options.contents) process.chdir(options.contents);

    if (options.preflight) {
      // Phase 1: Collect tokens (interactive)
      await createListr<Ctx>({
        title: "Collecting registry tokens",
        task: async (ctx, task): Promise<void> => {
          const registries = collectRegistries(ctx);
          const tokens = await collectTokens(registries, task);
          await promptGhSecretsSync(tokens, task);

          // Phase 2: Inject tokens and switch to non-interactive mode
          cleanupEnv = injectTokensToEnv(tokens);
          ctx.promptEnabled = false;
        },
      }).run(ctx);

      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);
    }

    if (!options.publishOnly && !options.preflight) {
      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);
    }

    await createListr<Ctx>(
      options.publishOnly
        ? {
            title: "Publishing",
            task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
              parentTask.newListr(await collectPublishTasks(ctx), {
                concurrent: true,
              }),
          }
        : [
            {
              skip: options.skipTests,
              title: "Running tests",
              task: async (ctx): Promise<void> => {
                const packageManager = await getPackageManager();

                try {
                  await exec(packageManager, ["run", ctx.testScript], {
                    throwOnError: true,
                  });
                } catch (error) {
                  throw new AbstractError(
                    `Test script '${ctx.testScript}' failed. Run \`${packageManager} run ${ctx.testScript}\` locally to see full output.`,
                    { cause: error },
                  );
                }
              },
            },
            {
              skip: options.skipBuild,
              title: "Building the project",
              task: async (ctx): Promise<void> => {
                const packageManager = await getPackageManager();

                try {
                  await exec(packageManager, ["run", ctx.buildScript], {
                    throwOnError: true,
                  });
                } catch (error) {
                  throw new AbstractError(
                    `Build script '${ctx.buildScript}' failed. Run \`${packageManager} run ${ctx.buildScript}\` locally to see full output.`,
                    { cause: error },
                  );
                }
              },
            },
            {
              title: "Bumping version",
              skip: (ctx) => !!ctx.preview,
              task: async (ctx, task): Promise<void> => {
                const git = new Git();
                let tagCreated = false;
                let commited = false;

                addRollback(async () => {
                  if (tagCreated) {
                    try {
                      rollbackLog("Deleting tag");
                      await git.deleteTag(`${await git.latestTag()}`);
                    } catch (error) {
                      rollbackError(
                        `Failed to delete tag: ${error instanceof Error ? error.message : error}`,
                      );
                    }
                  }

                  if (commited) {
                    try {
                      rollbackLog("Resetting commits");
                      await git.reset();
                      const dirty = (await git.status()) !== "";
                      if (dirty) {
                        await git.stash();
                      }
                      await git.reset("HEAD^", "--hard");
                      if (dirty) {
                        await git.popStash();
                      }
                    } catch (error) {
                      rollbackError(
                        `Failed to reset commits: ${error instanceof Error ? error.message : error}`,
                      );
                    }
                  }
                }, ctx);

                await git.reset();
                const replaced = await replaceVersion(
                  ctx.version,
                  ctx.packages,
                );

                for (const replacedFile of replaced) {
                  await git.stage(replacedFile);
                }

                const nextVersion = `v${ctx.version}`;
                const commit = await git.commit(nextVersion);

                commited = true;

                task.output = "Creating tag...";
                await git.createTag(nextVersion, commit);

                tagCreated = true;
              },
            },
            {
              skip: (ctx) =>
                !!options.skipPublish || !!ctx.preview || !!options.preflight,
              title: "Publishing",
              task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
                parentTask.newListr(await collectPublishTasks(ctx), {
                  concurrent: true,
                }),
            },
            {
              skip: !options.preflight,
              title: "Validating publish (dry-run)",
              task: async (ctx, parentTask): Promise<Listr<Ctx>> =>
                parentTask.newListr(await collectDryRunPublishTasks(ctx), {
                  concurrent: true,
                }),
            },
            {
              title: "Pushing tags to GitHub",
              skip: (ctx) => !!ctx.preview,
              task: async (_, task): Promise<void> => {
                const git = new Git();

                const result = await git.push("--follow-tags");

                if (!result) {
                  task.title +=
                    " (Only tags were pushed because the release branch is protected. Please push the branch manually.)";

                  await git.push("--tags");
                }
              },
            },
            {
              skip: (ctx) => !!options.skipReleaseDraft || !!ctx.preview,
              title: "Creating release draft on GitHub",
              task: async (ctx, task): Promise<void> => {
                const git = new Git();

                const repositoryUrl = await git.repository();

                const latestTag = `${await git.latestTag()}`;

                const lastRev =
                  (await git.previousTag(latestTag)) ||
                  (await git.firstCommit());

                const commits = (
                  await git.commits(lastRev, `${latestTag}`)
                ).slice(1);

                let body = commits
                  .map(
                    ({ id, message }) =>
                      `- ${message.replace("#", `${repositoryUrl}/issues/`)} ${repositoryUrl}/commit/${id}`,
                  )
                  .join("\n");

                body += `\n\n${repositoryUrl}/compare/${lastRev}...${latestTag}`;

                const releaseDraftUrl = new URL(
                  `${repositoryUrl}/releases/new`,
                );

                releaseDraftUrl.searchParams.set("tag", `${latestTag}`);
                releaseDraftUrl.searchParams.set("body", body);
                releaseDraftUrl.searchParams.set(
                  "prerelease",
                  `${!!prerelease(ctx.version)}`,
                );

                const linkUrl = link("Link", releaseDraftUrl.toString());

                task.title += ` ${linkUrl}`;

                await open(releaseDraftUrl.toString());
              },
            },
          ],
    ).run(ctx);

    const registries = collectRegistries(ctx);
    const parts: string[] = [];

    if (registries.includes("npm")) {
      const npmPackageName = (await getPackageJson()).name;
      parts.push(`${color.bold(npmPackageName)} on ${color.green("npm")}`);
    }

    if (registries.includes("jsr")) {
      const jsrPackageName = (await getJsrJson()).name;
      parts.push(`${color.bold(jsrPackageName)} on ${color.yellow("jsr")}`);
    }

    if (registries.includes("crates")) {
      const crateNames = ctx.packages
        ?.filter((pkg) => pkg.registries.includes("crates"))
        .map((pkg) => pkg.path) ?? ["crate"];
      for (const name of crateNames) {
        parts.push(`${color.bold(name)} on ${color.red("crates.io")}`);
      }
    }

    process.removeListener("SIGINT", onSigint);

    if (options.preflight) {
      cleanupEnv?.();
      console.log(
        `\n\n✅ Preflight check passed. CI publish should succeed for ${parts.join(", ")}.\n`,
      );
    } else {
      console.log(
        `\n\n🚀 Successfully published ${parts.join(", ")} ${color.blueBright(`v${ctx.version}`)} 🚀\n`,
      );
    }
  } catch (e: unknown) {
    process.removeListener("SIGINT", onSigint);
    cleanupEnv?.();
    consoleError(e as Error);

    await rollback();

    process.exit(1);
  }
}
