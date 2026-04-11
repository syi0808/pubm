import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { t } from "../i18n/index.js";
import { registryCatalog } from "../registry/catalog.js";
import type { NpmPackageRegistry } from "../registry/npm.js";
import { npmPackageRegistry } from "../registry/npm.js";
import { pathFromKey } from "../utils/package-key.js";
import { ui } from "../utils/ui.js";

class NpmAvailableError extends AbstractError {
  name = t("error.npm.unavailable");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export function createNpmPublishTask(key: string): ListrTask<PubmContext> {
  return {
    title: key,
    skip: (ctx) => !!ctx.options.dryRun,
    task: async (ctx, task): Promise<void> => {
      const npm = await npmPackageRegistry(pathFromKey(key));
      task.title = npm.packageName;

      const version = getPackageVersion(ctx, key);

      // Pre-check: skip if version already published
      if (await npm.isVersionPublished(version)) {
        task.title = t("task.npm.skipped", { version });
        task.output = t("task.npm.alreadyPublished", {
          name: npm.packageName,
          version,
        });
        return task.skip();
      }

      task.output = t("task.npm.publishing");

      try {
        if (ctx.runtime.promptEnabled) {
          // Try with cached OTP first (from another concurrent task)
          const result = await npm.publish(ctx.runtime.npmOtp, ctx.runtime.tag);

          if (!result) {
            // EOTP — use shared promise to avoid multiple prompts
            let isOtpCreator = false;
            if (!ctx.runtime.npmOtpPromise) {
              isOtpCreator = true;
              ctx.runtime.npmOtpPromise = (async () => {
                task.title = t("task.npm.otpTitle", { name: npm.packageName });
                const maxAttempts = 3;

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                  const otp = await task
                    .prompt(ListrEnquirerPromptAdapter)
                    .run<string>({
                      type: "password",
                      message: t("prompt.npm.otp", {
                        attempt:
                          attempt > 1
                            ? t("prompt.npm.otpAttempt", {
                                current: attempt,
                                max: maxAttempts,
                              })
                            : "",
                      }),
                    });

                  const success = await npm.publish(otp, ctx.runtime.tag);
                  if (success) {
                    ctx.runtime.npmOtp = otp;
                    task.title = t("task.npm.otpPassed", {
                      name: npm.packageName,
                    });
                    return otp;
                  }

                  if (attempt < maxAttempts) {
                    task.output = t("task.npm.otpFailed");
                  }
                }

                throw new NpmAvailableError(t("error.npm.otpFailed"));
              })();
            }

            const otp = await ctx.runtime.npmOtpPromise;
            // Only non-creator tasks publish here — the creator already
            // published inside the promise above.
            if (!isOtpCreator) {
              await npm.publish(otp, ctx.runtime.tag);
            }
          }
        } else {
          // CI mode
          const npmTokenEnv = process.env.NODE_AUTH_TOKEN;

          if (!npmTokenEnv) {
            throw new NpmAvailableError(t("error.npm.noAuthToken"));
          }

          const result = await npm.publishProvenance(ctx.runtime.tag);

          if (!result) {
            throw new NpmAvailableError(
              t("error.npm.2faInCi", { name: npm.packageName }),
            );
          }
        }
      } catch (error) {
        // Fallback: catch "already published" errors
        if (
          error instanceof Error &&
          (error.message.includes(
            "cannot publish over the previously published",
          ) ||
            error.message.includes(
              "You cannot publish over the previously published",
            ))
        ) {
          task.title = t("task.npm.skipped", { version });
          task.output = t("task.npm.alreadyPublished", {
            name: npm.packageName,
            version,
          });
          return task.skip();
        }
        throw error;
      }

      registerUnpublishRollback(ctx, npm, version);
    },
  };
}

function registerUnpublishRollback(
  ctx: PubmContext,
  registry: NpmPackageRegistry,
  version: string,
): void {
  if (!registry.supportsUnpublish) return;

  const canUnpublish =
    ctx.runtime.promptEnabled || ctx.config.rollback.dangerouslyAllowUnpublish;

  const verb = registryCatalog.get("npm")?.unpublishLabel ?? "Unpublish";

  if (!canUnpublish) {
    ctx.runtime.rollback.add({
      label: t("task.npm.rollbackSkipped", {
        verb,
        name: registry.packageName,
        version,
      }),
      fn: async () => {},
    });
    return;
  }

  // confirm: true serves the TTY path (triggers prompt). In CI it's inert —
  // non-interactive mode executes confirm actions without prompting.
  // On SIGINT, confirm actions are safely skipped regardless of dangerouslyAllowUnpublish.
  ctx.runtime.rollback.add({
    label: t("task.npm.rollbackBurned", {
      verb,
      name: registry.packageName,
      version,
    }),
    fn: async () => {
      await registry.unpublish(registry.packageName, version);
      console.log(
        `    ${ui.chalk.yellow("⚠")} ${t("task.npm.versionReserved", { version })}`,
      );
    },
    confirm: true,
  });
}
