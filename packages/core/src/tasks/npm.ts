import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type ListrTask } from "listr2";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { npmRegistry } from "../registry/npm.js";
import { link } from "../utils/cli.js";
import { openUrl } from "../utils/open-url.js";
import { spawnInteractive } from "../utils/spawn-interactive.js";

class NpmAvailableError extends AbstractError {
  name = "npm is unavailable for publishing.";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export const npmAvailableCheckTasks: ListrTask<PubmContext> = {
  title: "Checking npm avaliable for publising",
  task: async (ctx, task): Promise<void> => {
    const npm = await npmRegistry();

    if (!(await npm.isLoggedIn())) {
      if (ctx.runtime.promptEnabled) {
        try {
          task.output = "Launching npm login...";

          const child = spawnInteractive(["npm", "login"]);

          let opened = false;

          const readStream = async (
            stream: ReadableStream<Uint8Array>,
            onData: (text: string) => void,
          ) => {
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                onData(decoder.decode(value));
              }
            } finally {
              reader.releaseLock();
            }
          };

          await new Promise<void>((resolve, reject) => {
            const onData = (text: string) => {
              const urlMatch = text.match(
                /https:\/\/www\.npmjs\.com\/login[^\s]*/,
              );

              if (urlMatch && !opened) {
                opened = true;
                task.output = `Login at: ${color.cyan(urlMatch[0])}`;
                openUrl(urlMatch[0]);
                child.stdin.write("\n");
                child.stdin.flush();
              }
            };

            Promise.all([
              readStream(child.stdout, onData),
              readStream(child.stderr, onData),
            ]).catch(reject);

            child.exited
              .then((code) =>
                code === 0
                  ? resolve()
                  : reject(new Error(`npm login exited with code ${code}`)),
              )
              .catch(reject);
          });
        } catch (error) {
          throw new NpmAvailableError(
            "npm login failed. Please run `npm login` manually and try again.",
            { cause: error },
          );
        }

        if (!(await npm.isLoggedIn())) {
          throw new NpmAvailableError(
            "Still not logged in after npm login. Please verify your credentials.",
          );
        }
      } else {
        throw new NpmAvailableError(
          "Not logged in to npm. Set NODE_AUTH_TOKEN in your CI environment. For GitHub Actions, add it as a repository secret.",
        );
      }
    }

    if (await npm.isPublished()) {
      if (!(await npm.hasPermission())) {
        throw new NpmAvailableError(
          `You do not have permission to publish this package on ${color.green("npm")}.`,
        );
      }

      return void 0;
    }

    if (!(await npm.isPackageNameAvaliable())) {
      throw new NpmAvailableError(
        `Package is not published on ${color.green("npm")}, and the package name is not available. Please change the package name.
More information: ${link("npm naming rules", "https://github.com/npm/validate-npm-package-name?tab=readme-ov-file#naming-rules")}`,
      );
    }

    if (!ctx.runtime.promptEnabled) {
      const tfaMode = await npm.twoFactorAuthMode();

      if (tfaMode === "auth-and-writes") {
        throw new NpmAvailableError(
          `npm account has 2FA enabled for writes (auth-and-writes). CI publish will fail with EOTP. Use an automation token or configure granular access token at https://www.npmjs.com/package/${npm.packageName}/access`,
        );
      }
    }
  },
};

export const npmPublishTasks: ListrTask<PubmContext> = {
  title: "Running npm publish",
  skip: (ctx) => !!ctx.options.preview,
  task: async (ctx, task): Promise<void> => {
    const npm = await npmRegistry();

    // Pre-check: skip if version already published
    if (await npm.isVersionPublished(ctx.runtime.version)) {
      task.title = `[SKIPPED] npm: v${ctx.runtime.version} already published`;
      task.output = `⚠ ${npm.packageName}@${ctx.runtime.version} is already published on npm`;
      return task.skip();
    }

    task.output = "Publishing on npm...";

    try {
      if (ctx.runtime.promptEnabled) {
        let result = await npm.publish();

        if (!result) {
          task.title = "Running npm publish (OTP code needed)";
          const maxAttempts = 3;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            result = await npm.publish(
              await task.prompt(ListrEnquirerPromptAdapter).run<string>({
                type: "password",
                message: `npm OTP code${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`,
              }),
            );

            if (result) break;

            if (attempt < maxAttempts) {
              task.output = "2FA failed. Please try again.";
            }
          }

          if (!result) {
            throw new NpmAvailableError(
              "OTP verification failed after 3 attempts.",
            );
          }

          task.title = "Running npm publish (2FA passed)";
        }
      } else {
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
        task.title = `[SKIPPED] npm: v${ctx.runtime.version} already published`;
        task.output = `⚠ ${npm.packageName}@${ctx.runtime.version} is already published on npm`;
        return task.skip();
      }
      throw error;
    }
  },
};
