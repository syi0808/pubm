import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { t } from "../i18n/index.js";
import { JsrClient, jsrPackageRegistry } from "../registry/jsr.js";
import { openUrl } from "../utils/open-url.js";
import { pathFromKey } from "../utils/package-key.js";

class JsrAvailableError extends AbstractError {
  name = t("error.jsr.unavailable");

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export function createJsrPublishTask(key: string): ListrTask<PubmContext> {
  return {
    title: key,
    task: async (ctx, task): Promise<void> => {
      const jsr = await jsrPackageRegistry(pathFromKey(key));
      task.title = jsr.packageName;

      const version = getPackageVersion(ctx, key);

      // Pre-check: skip if version already published
      if (await jsr.isVersionPublished(version)) {
        task.title = t("task.jsr.skipped", { version });
        task.output = t("task.jsr.alreadyPublished", {
          name: jsr.packageName,
          version,
        });
        return task.skip();
      }

      task.output = t("task.jsr.publishing");

      try {
        if (!JsrClient.token && !ctx.runtime.promptEnabled) {
          const jsrTokenEnv = process.env.JSR_TOKEN;

          if (!jsrTokenEnv) {
            throw new JsrAvailableError(t("error.jsr.noToken"));
          }

          JsrClient.token = jsrTokenEnv;
        }

        let result = await jsr.publish();

        if (!result && jsr.packageCreationUrls) {
          if (ctx.runtime.promptEnabled) {
            task.title = t("task.jsr.packageCreation");
            const urls = jsr.packageCreationUrls;
            const maxAttempts = 3;

            task.output = t("task.jsr.createPackage", {
              urls: urls.map((url) => `  ${color.cyan(url)}`).join("\n"),
            });

            openUrl(urls[0]);

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              await task.prompt(ListrEnquirerPromptAdapter).run<string>({
                type: "input",
                message: t("prompt.jsr.pressEnter", {
                  key: color.bold("enter"),
                  attempt:
                    attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "",
                }),
              });

              result = await jsr.publish();

              if (result) break;

              if (attempt < maxAttempts) {
                task.output = t("task.jsr.stillNotExists");
              }
            }

            if (!result) {
              throw new JsrAvailableError(t("error.jsr.creationFailed"));
            }

            task.title = t("task.jsr.packageCreated");
          } else {
            throw new JsrAvailableError(
              t("task.jsr.createPackage", {
                urls: jsr.packageCreationUrls.join("\n"),
              }),
            );
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("already published")
        ) {
          task.title = t("task.jsr.skipped", { version });
          task.output = t("task.jsr.alreadyPublished", {
            name: jsr.packageName,
            version,
          });
          return task.skip();
        }
        throw error;
      }
    },
  };
}
