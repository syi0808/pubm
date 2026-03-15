import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { JsrClient, jsrPackageRegistry } from "../registry/jsr.js";
import { openUrl } from "../utils/open-url.js";

class JsrAvailableError extends AbstractError {
  name = "jsr is unavailable for publishing.";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export function createJsrPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: packagePath,
    task: async (ctx, task): Promise<void> => {
      const jsr = await jsrPackageRegistry(packagePath);
      task.title = jsr.packageName;

      const version = getPackageVersion(ctx, jsr.packageName);

      // Pre-check: skip if version already published
      if (await jsr.isVersionPublished(version)) {
        task.title = `[SKIPPED] jsr: v${version} already published`;
        task.output = `⚠ ${jsr.packageName}@${version} is already published on jsr`;
        return task.skip();
      }

      task.output = "Publishing on jsr...";

      try {
        if (!JsrClient.token && !ctx.runtime.promptEnabled) {
          const jsrTokenEnv = process.env.JSR_TOKEN;

          if (!jsrTokenEnv) {
            throw new JsrAvailableError(
              "JSR_TOKEN not found in the environment variables. Please set the token and try again.",
            );
          }

          JsrClient.token = jsrTokenEnv;
        }

        let result = await jsr.publish();

        if (!result && jsr.packageCreationUrls) {
          if (ctx.runtime.promptEnabled) {
            task.title = "Running jsr publish (package creation needed)";
            const urls = jsr.packageCreationUrls;
            const maxAttempts = 3;

            task.output = `Package doesn't exist on jsr. Create it at:\n${urls.map((url) => `  ${color.cyan(url)}`).join("\n")}`;

            openUrl(urls[0]);

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              await task.prompt(ListrEnquirerPromptAdapter).run<string>({
                type: "input",
                message: `Press ${color.bold("enter")} after creating the package on jsr.io${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`,
              });

              result = await jsr.publish();

              if (result) break;

              if (attempt < maxAttempts) {
                task.output =
                  "Package still doesn't exist. Please create it and try again.";
              }
            }

            if (!result) {
              throw new JsrAvailableError(
                "Package creation not completed after 3 attempts.",
              );
            }

            task.title = "Running jsr publish (package created)";
          } else {
            throw new JsrAvailableError(
              `Package doesn't exist on jsr. Create it at:\n${jsr.packageCreationUrls.join("\n")}`,
            );
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("already published")
        ) {
          task.title = `[SKIPPED] jsr: v${version} already published`;
          task.output = `⚠ ${jsr.packageName}@${version} is already published on jsr`;
          return task.skip();
        }
        throw error;
      }
    },
  };
}
