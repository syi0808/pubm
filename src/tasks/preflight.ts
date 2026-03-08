import { createHash } from "node:crypto";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { exec } from "tinyexec";
import { AbstractError } from "../error.js";
import { Db } from "../utils/db.js";
import { loadTokensFromDb, TOKEN_CONFIG } from "../utils/token.js";

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
    const config = TOKEN_CONFIG[registry];
    if (!config || tokens[registry]) continue;

    task.output = `Enter ${config.promptLabel}`;
    const token = await task.prompt(ListrEnquirerPromptAdapter).run({
      type: "password",
      message: `Enter ${config.promptLabel}`,
    });

    tokens[registry] = token;
    new Db().set(config.dbKey, token);
  }

  return tokens;
}

export async function syncGhSecrets(
  tokens: Record<string, string>,
): Promise<void> {
  for (const [registry, token] of Object.entries(tokens)) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

    const result = exec("gh", ["secret", "set", config.ghSecretName], {
      throwOnError: true,
    });
    const proc = result.process;
    if (proc?.stdin) {
      proc.stdin.end(token);
    }
    await result;
  }
}

function tokensSyncHash(tokens: Record<string, string>): string {
  const sorted = Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .slice(0, 16);
}

const SYNC_HASH_DB_KEY = "gh-secrets-sync-hash";

export async function promptGhSecretsSync(
  tokens: Record<string, string>,
  // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex and not easily typed inline
  task: any,
): Promise<void> {
  const db = new Db();
  const currentHash = tokensSyncHash(tokens);
  const storedHash = db.get(SYNC_HASH_DB_KEY);

  if (storedHash === currentHash) {
    task.output = "Tokens already synced to GitHub Secrets.";
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
      db.set(SYNC_HASH_DB_KEY, currentHash);
      task.output = "Tokens synced to GitHub Secrets.";
    } catch (error) {
      throw new PreflightError(
        "Failed to sync tokens to GitHub Secrets. Ensure `gh` CLI is installed and authenticated (`gh auth login`).",
        { cause: error },
      );
    }
  }
}
