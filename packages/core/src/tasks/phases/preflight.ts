import process from "node:process";
import type { PubmContext } from "../../context.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import { registryCatalog } from "../../registry/catalog.js";
import { JsrClient } from "../../registry/jsr.js";
import { createListr } from "../../utils/listr.js";
import { parseOwnerRepo } from "../../utils/parse-owner-repo.js";
import { collectRegistries } from "../../utils/registries.js";
import {
  injectPluginTokensToEnv,
  injectTokensToEnv,
} from "../../utils/token.js";
import {
  collectPluginCredentials,
  collectTokens,
  type GhSecretEntry,
  promptGhSecretsSync,
} from "../preflight.js";
import { prerequisitesCheckTask } from "../prerequisites-check.js";
import { requiredConditionsCheckTask } from "../required-conditions-check.js";

export interface CleanupRef {
  current: (() => void) | undefined;
}

export async function runCiPreparePreflight(
  ctx: PubmContext,
  chainCleanup: (
    existing: (() => void) | undefined,
    next: () => void,
  ) => () => void,
  cleanupRef: CleanupRef,
): Promise<void> {
  // CI prepare: Collect tokens (interactive)
  await createListr<PubmContext>({
    title: t("task.tokens.collecting"),
    task: async (ctx, task): Promise<void> => {
      const registries = collectRegistries(ctx.config);
      const tokens = await collectTokens(registries, task);

      // Collect plugin credentials
      const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
      const pluginTokens = await collectPluginCredentials(
        pluginCreds,
        ctx.runtime.promptEnabled,
        task,
      );
      ctx.runtime.pluginTokens = pluginTokens;

      // Build plugin secrets for GitHub sync
      const pluginSecrets: GhSecretEntry[] = pluginCreds
        .filter(
          (c): c is typeof c & { ghSecretName: string } =>
            !!c.ghSecretName && !!pluginTokens[c.key],
        )
        .map((c) => ({
          secretName: c.ghSecretName,
          token: pluginTokens[c.key],
        }));

      let repoSlug: string;
      try {
        const remoteUrl = await new Git().repository();
        const { owner, repo } = parseOwnerRepo(remoteUrl);
        repoSlug = `${owner}/${repo}`;
      } catch {
        repoSlug = process.cwd();
      }

      await promptGhSecretsSync(tokens, task, pluginSecrets, repoSlug);

      // Inject tokens and switch to non-interactive mode
      cleanupRef.current = injectTokensToEnv(tokens);
      cleanupRef.current = chainCleanup(
        cleanupRef.current,
        injectPluginTokensToEnv(pluginTokens, pluginCreds),
      );
      ctx.runtime.promptEnabled = false;
    },
  }).run(ctx);

  await prerequisitesCheckTask({
    skip: ctx.options.skipPrerequisitesCheck,
  }).run(ctx);

  await requiredConditionsCheckTask({
    skip: ctx.options.skipConditionsCheck,
  }).run(ctx);
}

export async function runLocalPreflight(
  ctx: PubmContext,
  chainCleanup: (
    existing: (() => void) | undefined,
    next: () => void,
  ) => () => void,
  cleanupRef: CleanupRef,
): Promise<void> {
  await prerequisitesCheckTask({
    skip: ctx.options.skipPrerequisitesCheck,
  }).run(ctx);

  // Collect tokens early for registries that require early auth
  const registries = collectRegistries(ctx.config);
  const earlyAuthRegistries = registries.filter((r) => {
    const desc = registryCatalog.get(r);
    return desc?.requiresEarlyAuth;
  });

  if (earlyAuthRegistries.length > 0 && ctx.runtime.promptEnabled) {
    await createListr<PubmContext>({
      title: t("task.tokens.ensuring"),
      task: async (_ctx, task): Promise<void> => {
        const tokens = await collectTokens(earlyAuthRegistries, task);
        cleanupRef.current = injectTokensToEnv(tokens);
        // TODO(extensibility): replace with descriptor-driven client injection (e.g., onTokenCollected callback)
        if (tokens.jsr) {
          JsrClient.token = tokens.jsr;
        }
      },
    }).run(ctx);
  }

  // Collect plugin credentials
  const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
  if (pluginCreds.length > 0) {
    await createListr<PubmContext>({
      title: t("task.tokens.collectingPlugin"),
      task: async (ctx, task): Promise<void> => {
        const pluginTokens = await collectPluginCredentials(
          pluginCreds,
          ctx.runtime.promptEnabled,
          task,
        );
        ctx.runtime.pluginTokens = pluginTokens;
        cleanupRef.current = chainCleanup(
          cleanupRef.current,
          injectPluginTokensToEnv(pluginTokens, pluginCreds),
        );
      },
    }).run(ctx);
  }

  await requiredConditionsCheckTask({
    skip: ctx.options.skipConditionsCheck,
  }).run(ctx);
}

export async function runCiPublishPluginCreds(
  ctx: PubmContext,
  chainCleanup: (
    existing: (() => void) | undefined,
    next: () => void,
  ) => () => void,
  cleanupRef: CleanupRef,
): Promise<void> {
  // CI publish: collect plugin credentials from env (no prompting)
  const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
  if (pluginCreds.length > 0) {
    await createListr<PubmContext>({
      title: t("task.tokens.collectingPlugin"),
      task: async (ctx, task): Promise<void> => {
        const pluginTokens = await collectPluginCredentials(
          pluginCreds,
          false, // No prompting in CI
          task,
        );
        ctx.runtime.pluginTokens = pluginTokens;
        cleanupRef.current = chainCleanup(
          cleanupRef.current,
          injectPluginTokensToEnv(pluginTokens, pluginCreds),
        );
      },
    }).run(ctx);
  }
}
