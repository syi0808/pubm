import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type ListrTask } from "listr2";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { Git } from "../git.js";
import {
  JsrClient,
  JsrPackageRegistry,
  jsrPackageRegistry,
} from "../registry/jsr.js";
import { npmPackageRegistry } from "../registry/npm.js";
import { link } from "../utils/cli.js";
import { openUrl } from "../utils/open-url.js";
import { getScope, isScopedPackage } from "../utils/package-name.js";
import { addRollback } from "../utils/rollback.js";
import { SecureStore } from "../utils/secure-store.js";

class JsrAvailableError extends AbstractError {
  name = "jsr is unavailable for publishing.";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });

    this.stack = "";
  }
}

export const jsrAvailableCheckTasks: ListrTask<PubmContext> = {
  title: "Checking jsr avaliable for publising",
  task: async (ctx, task): Promise<void> => {
    const jsr = await jsrPackageRegistry();

    addRollback(async (ctx): Promise<void> => {
      if (ctx.runtime.packageCreated) {
        await jsr.client.deletePackage(jsr.packageName);
      }

      if (ctx.runtime.scopeCreated) {
        await jsr.client.deleteScope(`${getScope(jsr.packageName)}`);
      }
    }, ctx);

    if (!JsrClient.token) {
      task.output = "Retrieving jsr API token";

      if (ctx.runtime.promptEnabled) {
        const maxAttempts = 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          JsrClient.token = await task
            .prompt(ListrEnquirerPromptAdapter)
            .run<string>({
              type: "password",
              message: `Please enter the jsr ${color.bold("API token")}${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`,
              footer: `\nGenerate a token from ${color.bold(link("jsr.io", "https://jsr.io/account/tokens/create/"))}. ${color.red("You should select")} ${color.bold("'Interact with the JSR API'")}.`,
            });

          try {
            if (await jsr.client.user()) break;

            if (attempt < maxAttempts) {
              task.output =
                "The jsr API token is invalid. Please re-enter a valid token.";
            }
          } catch (error) {
            if (
              error instanceof Error &&
              (error.message.includes("fetch") ||
                error.message.includes("network") ||
                error.message.includes("ENOTFOUND"))
            ) {
              throw new JsrAvailableError(
                "JSR API is unreachable. Check your network connection.",
                { cause: error },
              );
            }

            if (attempt < maxAttempts) {
              task.output =
                "The jsr API token is invalid. Please re-enter a valid token.";
            }
          }

          if (attempt === maxAttempts) {
            throw new JsrAvailableError(
              "JSR token verification failed after 3 attempts.",
            );
          }
        }
      } else {
        const jsrTokenEnv = process.env.JSR_TOKEN;

        if (!jsrTokenEnv)
          throw new JsrAvailableError(
            "JSR_TOKEN not found in the environment variables. Please set the token and try again.",
          );

        JsrClient.token = jsrTokenEnv;
      }

      if (ctx.options.saveToken)
        new SecureStore().set("jsr-token", JsrClient.token);
    }

    if (!isScopedPackage(jsr.packageName)) {
      let jsrName = new SecureStore().get(jsr.packageName);

      task.output =
        "The package name is not scoped. Searching for available scopes on jsr.";

      const scopes = await jsr.client.scopes();

      // biome-ignore lint/suspicious/noConfusingLabels: label used for break control flow
      checkScopeTask: if (!jsrName) {
        task.output = "Select an existing published package to publish.";

        const searchResults = (
          await Promise.all(
            scopes.map((scope) =>
              jsr.client.package(`@${scope}/${jsr.packageName}`),
            ),
          )
        ).filter((v): v is NonNullable<typeof v> => v !== null);

        if (searchResults.length > 0) {
          jsrName = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
            type: "select",
            message:
              "Is there a scoped package you want to publish in the already published list?",
            choices: [
              ...searchResults.map(({ scope, name }) => ({
                message: `@${scope}/${name}`,
                name: `@${scope}/${name}`,
              })),
              {
                message: "None",
                name: "none",
              },
            ],
          });

          if (jsrName !== "none") break checkScopeTask;
        }

        const userName = await new Git().userName();

        task.output = "Select the scope of the package to publish";

        jsrName = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
          type: "select",
          message:
            "jsr.json does not exist, and the package name is not scoped. Please select a scope for the 'jsr' package",
          choices: [
            {
              message: `@${jsr.packageName}/${jsr.packageName} ${color.dim("scoped by package name")}${scopes.includes(jsr.packageName) ? " (already created)" : ""}`,
              name: `@${jsr.packageName}/${jsr.packageName}`,
            },
            {
              message: `@${userName}/${jsr.packageName} ${color.dim("scoped by git name")}${scopes.includes(userName) ? " (already created)" : ""}`,
              name: `@${userName}/${jsr.packageName}`,
            },
            ...scopes.flatMap((scope) =>
              scope === jsr.packageName || scope === userName
                ? []
                : [
                    {
                      message: `@${scope}/${jsr.packageName} ${color.dim("scope from jsr")}`,
                      name: `@${scope}/${jsr.packageName}`,
                    },
                  ],
            ),
            {
              message: "Other (Specify)",
              name: "specify",
            },
          ],
        });

        if (jsrName === "specify") {
          while (!isScopedPackage(jsrName)) {
            jsrName = await task
              .prompt(ListrEnquirerPromptAdapter)
              .run<string>({
                type: "input",
                message: "Package name",
              });
          }
        }

        const scope = jsrName.match(/^@([^/]+)/)?.[1];

        if (scope && !scopes.includes(scope)) {
          task.output = "Creating scope for jsr...";
          await jsr.client.createScope(scope);
          ctx.runtime.scopeCreated = true;
        }

        if (ctx.runtime.scopeCreated || !(await jsr.client.package(jsrName))) {
          task.output = "Creating package for jsr...";
          await jsr.client.createPackage(jsrName);
          ctx.runtime.packageCreated = true;
        }
      }

      jsr.packageName = jsrName;

      JsrPackageRegistry.reader.invalidate(process.cwd());
    }

    const npm = await npmPackageRegistry();
    const hasPermission = await jsr.hasPermission();

    if (isScopedPackage(npm.packageName) && !hasPermission) {
      throw new JsrAvailableError(
        `You do not have permission to publish scope '${getScope(npm.packageName)}'. If you want to claim it, please contact ${link("help@jsr.io", "mailto:help@jsr.io")}.`,
      );
    }

    if (await jsr.isPublished()) {
      if (!hasPermission) {
        throw new JsrAvailableError(
          `You do not have permission to publish this package on ${color.yellow("jsr")}.`,
        );
      }

      return void 0;
    }

    if (!(await jsr.isPackageNameAvailable())) {
      throw new JsrAvailableError(
        `Package is not published on ${color.yellow("jsr")}, and the package name is not available. Please change the package name.
More information: ${link("npm naming rules", "https://github.com/npm/validate-npm-package-name?tab=readme-ov-file#naming-rules")}`,
      );
    }
  },
};

export const jsrPublishTasks: ListrTask<PubmContext> = {
  title: "Running jsr publish",
  task: async (ctx, task): Promise<void> => {
    const jsr = await jsrPackageRegistry();

    // Pre-check: skip if version already published
    if (await jsr.isVersionPublished(ctx.runtime.version!)) {
      task.title = `[SKIPPED] jsr: v${ctx.runtime.version} already published`;
      task.output = `⚠ ${jsr.packageName}@${ctx.runtime.version} is already published on jsr`;
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
        task.title = `[SKIPPED] jsr: v${ctx.runtime.version} already published`;
        task.output = `⚠ ${jsr.packageName}@${ctx.runtime.version} is already published on jsr`;
        return task.skip();
      }
      throw error;
    }
  },
};
