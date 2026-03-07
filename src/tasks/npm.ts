import { spawn } from "node:child_process";
import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import npmCli from "@npmcli/promise-spawn";
import { color, type ListrTask } from "listr2";
import { AbstractError } from "../error.js";
import { npmRegistry } from "../registry/npm.js";
import { link } from "../utils/cli.js";
import type { Ctx } from "./runner.js";

const { open } = npmCli;

class NpmAvailableError extends AbstractError {
  name = "npm is unavailable for publishing.";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export const npmAvailableCheckTasks: ListrTask<Ctx> = {
  title: "Checking npm avaliable for publising",
  skip: (ctx) => !!ctx.preview,
  task: async (ctx, task): Promise<void> => {
    const npm = await npmRegistry();

    if (!(await npm.isLoggedIn())) {
      if (ctx.promptEnabled) {
        try {
          task.output = "Launching npm login...";

          await new Promise<void>((resolve, reject) => {
            const child = spawn("npm", ["login"], {
              stdio: ["pipe", "pipe", "pipe"],
            });

            let opened = false;

            const onData = (data: Buffer) => {
              const text = data.toString();
              const urlMatch = text.match(
                /https:\/\/www\.npmjs\.com\/login[^\s]*/,
              );

              if (urlMatch && !opened) {
                opened = true;
                task.output = `Login at: ${color.cyan(urlMatch[0])}`;
                open(urlMatch[0]);
                child.stdin?.write("\n");
              }
            };

            child.stdout?.on("data", onData);
            child.stderr?.on("data", onData);
            child.on("close", (code) =>
              code === 0
                ? resolve()
                : reject(new Error(`npm login exited with code ${code}`)),
            );
            child.on("error", reject);
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
  },
};

export const npmPublishTasks: ListrTask<Ctx> = {
  title: "Running npm publish",
  skip: (ctx) => !!ctx.preview,
  task: async (ctx, task): Promise<void> => {
    const npm = await npmRegistry();

    task.output = "Publishing on npm...";

    if (ctx.promptEnabled) {
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
  },
};
