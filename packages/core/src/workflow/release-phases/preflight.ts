import type { PubmContext } from "../../context.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import { registryCatalog } from "../../registry/catalog.js";
import { JsrClient } from "../../registry/jsr.js";
import {
  collectPluginCredentials,
  collectTokens,
  type GhSecretEntry,
  promptGhSecretsSync,
} from "../../tasks/preflight.js";
import { parseOwnerRepo } from "../../utils/parse-owner-repo.js";
import { collectRegistries } from "../../utils/registries.js";
import {
  injectPluginTokensToEnv,
  injectTokensToEnv,
} from "../../utils/token.js";
import { runReleaseOperations } from "../release-operation.js";
import {
  createPrerequisitesCheckOperation,
  createRequiredConditionsCheckOperation,
} from "./preflight-checks.js";

export interface CleanupRef {
  current: (() => void) | undefined;
}

type OperationExecutor = typeof runReleaseOperations;

export async function runCiPreparePreflight(
  ctx: PubmContext,
  chainCleanup: (
    existing: (() => void) | undefined,
    next: () => void,
  ) => () => void,
  cleanupRef: CleanupRef,
  executeOperations: OperationExecutor = runReleaseOperations,
): Promise<void> {
  // CI prepare: Collect tokens (interactive)
  await executeOperations(ctx, {
    title: t("task.tokens.collecting"),
    run: async (ctx, task): Promise<void> => {
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
        repoSlug = ctx.cwd;
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
  });

  await executeOperations(
    ctx,
    createPrerequisitesCheckOperation(ctx.options.skipPrerequisitesCheck),
  );

  await executeOperations(
    ctx,
    createRequiredConditionsCheckOperation(ctx.options.skipConditionsCheck),
  );
}

export async function runLocalPreflight(
  ctx: PubmContext,
  chainCleanup: (
    existing: (() => void) | undefined,
    next: () => void,
  ) => () => void,
  cleanupRef: CleanupRef,
  executeOperations: OperationExecutor = runReleaseOperations,
): Promise<void> {
  await executeOperations(
    ctx,
    createPrerequisitesCheckOperation(ctx.options.skipPrerequisitesCheck),
  );

  // Collect tokens early for registries that require early auth
  const registries = collectRegistries(ctx.config);
  const earlyAuthRegistries = registries.filter((r) => {
    const desc = registryCatalog.get(r);
    return desc?.requiresEarlyAuth;
  });

  if (earlyAuthRegistries.length > 0 && ctx.runtime.promptEnabled) {
    await executeOperations(ctx, {
      title: t("task.tokens.ensuring"),
      run: async (_ctx, task): Promise<void> => {
        const tokens = await collectTokens(earlyAuthRegistries, task);
        cleanupRef.current = injectTokensToEnv(tokens);
        // TODO(extensibility): replace with descriptor-driven client injection (e.g., onTokenCollected callback)
        if (tokens.jsr) {
          JsrClient.token = tokens.jsr;
        }
      },
    });
  }

  // Collect plugin credentials
  const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
  if (pluginCreds.length > 0) {
    await executeOperations(ctx, {
      title: t("task.tokens.collectingPlugin"),
      run: async (ctx, task): Promise<void> => {
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
    });
  }

  await executeOperations(
    ctx,
    createRequiredConditionsCheckOperation(ctx.options.skipConditionsCheck),
  );
}

export async function runCiPublishPluginCreds(
  ctx: PubmContext,
  chainCleanup: (
    existing: (() => void) | undefined,
    next: () => void,
  ) => () => void,
  cleanupRef: CleanupRef,
  executeOperations: OperationExecutor = runReleaseOperations,
): Promise<void> {
  // CI publish: collect plugin credentials from env (no prompting)
  const pluginCreds = ctx.runtime.pluginRunner.collectCredentials(ctx);
  if (pluginCreds.length > 0) {
    await executeOperations(ctx, {
      title: t("task.tokens.collectingPlugin"),
      run: async (ctx, task): Promise<void> => {
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
    });
  }
}
