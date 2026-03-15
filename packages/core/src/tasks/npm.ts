import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { ListrTask } from "listr2";
import { type PubmContext, getPackageVersion } from "../context.js";
import { AbstractError } from "../error.js";
import { npmPackageRegistry } from "../registry/npm.js";

class NpmAvailableError extends AbstractError {
  name = "npm is unavailable for publishing.";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export function createNpmPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: packagePath,
    skip: (ctx) => !!ctx.options.preview,
    task: async (ctx, task): Promise<void> => {
      const npm = await npmPackageRegistry(packagePath);
      task.title = npm.packageName;

      const version = getPackageVersion(ctx, npm.packageName);

      // Pre-check: skip if version already published
      if (await npm.isVersionPublished(version)) {
        task.title = `[SKIPPED] npm: v${version} already published`;
        task.output = `⚠ ${npm.packageName}@${version} is already published on npm`;
        return task.skip();
      }

      task.output = "Publishing on npm...";

      try {
        if (ctx.runtime.promptEnabled) {
          // Try with cached OTP first (from another concurrent task)
          const result = await npm.publish(ctx.runtime.npmOtp);

          if (!result) {
            // EOTP — use shared promise to avoid multiple prompts
            if (!ctx.runtime.npmOtpPromise) {
              ctx.runtime.npmOtpPromise = (async () => {
                task.title = `${npm.packageName} (OTP code needed)`;
                const maxAttempts = 3;

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                  const otp = await task
                    .prompt(ListrEnquirerPromptAdapter)
                    .run<string>({
                      type: "password",
                      message: `npm OTP code${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`,
                    });

                  const success = await npm.publish(otp);
                  if (success) {
                    ctx.runtime.npmOtp = otp;
                    task.title = `${npm.packageName} (2FA passed)`;
                    return otp;
                  }

                  if (attempt < maxAttempts) {
                    task.output = "2FA failed. Please try again.";
                  }
                }

                throw new NpmAvailableError(
                  "OTP verification failed after 3 attempts.",
                );
              })();
            }

            const otp = await ctx.runtime.npmOtpPromise;
            // Other concurrent tasks: publish with shared OTP
            if (!ctx.runtime.npmOtp || ctx.runtime.npmOtp !== otp) {
              await npm.publish(otp);
            }
          }
        } else {
          // CI mode
          const npmTokenEnv = process.env.NODE_AUTH_TOKEN;

          if (!npmTokenEnv) {
            throw new NpmAvailableError(
              "NODE_AUTH_TOKEN not found in environment variables. Set it in your CI configuration:\n" +
                "  GitHub Actions: Add NODE_AUTH_TOKEN as a repository secret\n" +
                "  Other CI: Export NODE_AUTH_TOKEN with your npm access token",
            );
          }

          const result = await npm.publishProvenance();

          if (!result) {
            throw new NpmAvailableError(
              `In CI environment, publishing with 2FA is not allowed. Please disable 2FA when accessing with a token from https://www.npmjs.com/package/${npm.packageName}/access `,
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
          task.title = `[SKIPPED] npm: v${version} already published`;
          task.output = `⚠ ${npm.packageName}@${version} is already published on npm`;
          return task.skip();
        }
        throw error;
      }
    },
  };
}
