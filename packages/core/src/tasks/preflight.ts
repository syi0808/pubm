import { createHash } from "node:crypto";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color } from "listr2";
import { AbstractError } from "../error.js";
import { registryCatalog } from "../registry/catalog.js";
import { link } from "../utils/cli.js";
import { exec } from "../utils/exec.js";
import {
  readGhSecretsSyncHash,
  writeGhSecretsSyncHash,
} from "../utils/gh-secrets-sync-state.js";
import { SecureStore } from "../utils/secure-store.js";
import { loadTokensFromDb } from "../utils/token.js";

class PreflightError extends AbstractError {
  name = "Preflight Error";
}

export async function collectTokens(
  registries: string[],
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
  task: any,
): Promise<Record<string, string>> {
  const existing = loadTokensFromDb(registries);
  const tokens: Record<string, string> = { ...existing };

  for (const registry of registries) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor || tokens[registry]) continue;
    const config = descriptor.tokenConfig;

    let { tokenUrl } = config;
    if (descriptor.resolveTokenUrl) {
      tokenUrl = await descriptor.resolveTokenUrl(tokenUrl);
    }

    task.output = `Enter ${config.promptLabel}`;
    const token = await task.prompt(ListrEnquirerPromptAdapter).run({
      type: "password",
      message: `Enter ${config.promptLabel}`,
      footer: `\nGenerate a token from ${color.bold(link(config.tokenUrlLabel, tokenUrl))}`,
    });

    if (!`${token}`.trim()) {
      throw new PreflightError(
        `${config.promptLabel} is required to continue in preflight mode.`,
      );
    }

    tokens[registry] = token;
    new SecureStore().set(config.dbKey, token);
  }

  return tokens;
}

export async function syncGhSecrets(
  tokens: Record<string, string>,
): Promise<void> {
  for (const [registry, token] of Object.entries(tokens)) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor) continue;
    const config = descriptor.tokenConfig;

    await exec("gh", ["secret", "set", config.ghSecretName, "--body", token], {
      throwOnError: true,
    });
  }
}

function tokensSyncHash(tokens: Record<string, string>): string {
  const sorted = Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .slice(0, 16);
}

export async function promptGhSecretsSync(
  tokens: Record<string, string>,
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
  task: any,
): Promise<void> {
  const currentHash = tokensSyncHash(tokens);
  const storedHash = readGhSecretsSyncHash();

  if (storedHash === currentHash) {
    task.output =
      "GitHub Secrets sync already acknowledged for the current tokens.";
    return;
  }

  const shouldSync = await task.prompt(ListrEnquirerPromptAdapter).run({
    type: "toggle",
    message: "Sync tokens to GitHub Secrets?",
    enabled: "Yes",
    disabled: "No",
  });

  if (shouldSync) {
    task.output = "Syncing tokens to GitHub Secrets...";
    try {
      await syncGhSecrets(tokens);
      task.output = "Tokens synced to GitHub Secrets.";
    } catch (error) {
      throw new PreflightError(
        "Failed to sync tokens to GitHub Secrets. Ensure `gh` CLI is installed and authenticated (`gh auth login`).",
        { cause: error },
      );
    }
  }

  try {
    writeGhSecretsSyncHash(currentHash);
  } catch (error) {
    throw new PreflightError("Failed to save GitHub Secrets sync state.", {
      cause: error,
    });
  }
}
