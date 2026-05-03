import { createHash } from "node:crypto";
import { color } from "@pubm/runner";
import { AbstractError } from "../error.js";
import { t } from "../i18n/index.js";
import type { PluginCredential } from "../plugin/types.js";
import { wrapTaskContext } from "../plugin/wrap-task-context.js";
import { registryCatalog } from "../registry/catalog.js";
import { exec } from "../utils/exec.js";
import {
  readGhSecretsSyncHash,
  writeGhSecretsSyncHash,
} from "../utils/gh-secrets-sync-state.js";
import { SecureStore } from "../utils/secure-store.js";
import { loadTokensFromDb } from "../utils/token.js";
import { ui } from "../utils/ui.js";

class PreflightError extends AbstractError {
  name = t("error.preflight.name");
}

function formatTokenUrlInfo(label: string, url: string): string {
  const linkedLabel = ui.link(label, url);
  const display = label === url ? linkedLabel : `${linkedLabel} (${url})`;
  return t("task.preflight.tokenUrl", {
    url: color.bold(display),
  });
}

export async function collectTokens(
  registries: string[],
  // biome-ignore lint/suspicious/noExplicitAny: runner task context type is complex and not easily typed inline
  task: any,
  promptEnabled = true,
): Promise<Record<string, string>> {
  const existing = loadTokensFromDb(registries);
  const tokens: Record<string, string> = { ...existing };

  for (const registry of registries) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor) continue;
    const config = descriptor.tokenConfig;

    // Validate existing token (from env or SecureStore)
    if (tokens[registry] && descriptor.validateToken) {
      task.output = t("task.preflight.validatingStored", {
        label: config.promptLabel,
      });
      const isValid = await descriptor.validateToken(tokens[registry]);

      if (!isValid) {
        // Check if token came from environment variable
        if (process.env[config.envVar]) {
          throw new PreflightError(
            t("error.preflight.envInvalid", { env: config.envVar }),
          );
        }

        // Token from SecureStore — delete and re-prompt
        task.output = t("task.preflight.storedInvalid", {
          label: config.promptLabel,
        });
        new SecureStore().delete(config.dbKey);
        delete tokens[registry];
      }
    }

    if (tokens[registry]) continue;

    if (!promptEnabled) {
      throw new PreflightError(
        t("error.preflight.envRequired", {
          label: config.promptLabel,
          env: config.envVar,
        }),
      );
    }

    let { tokenUrl } = config;
    if (descriptor.resolveTokenUrl) {
      tokenUrl = await descriptor.resolveTokenUrl(tokenUrl);
    }

    // Prompt loop (infinite until valid token or Ctrl+C)
    while (true) {
      task.output = t("task.preflight.enter", { label: config.promptLabel });
      const token = await task.prompt().run({
        type: "password",
        message: t("task.preflight.enter", { label: config.promptLabel }),
        footer: formatTokenUrlInfo(config.tokenUrlLabel, tokenUrl),
      });

      if (!`${token}`.trim()) {
        throw new PreflightError(
          t("error.preflight.required", { label: config.promptLabel }),
        );
      }

      if (descriptor.validateToken) {
        task.output = t("task.preflight.validating", {
          label: config.promptLabel,
        });
        const isValid = await descriptor.validateToken(token);

        if (!isValid) {
          task.output = t("task.preflight.invalid", {
            label: config.promptLabel,
          });
          continue;
        }
      }

      tokens[registry] = token;
      new SecureStore().set(config.dbKey, token);
      break;
    }
  }

  return tokens;
}

export interface GhSecretEntry {
  secretName: string;
  token: string;
}

export async function syncGhSecrets(
  tokens: Record<string, string>,
  pluginSecrets: GhSecretEntry[] = [],
): Promise<void> {
  // Registry tokens
  for (const [registry, token] of Object.entries(tokens)) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor) continue;
    const config = descriptor.tokenConfig;

    await exec("gh", ["secret", "set", config.ghSecretName, "--body", token], {
      throwOnError: true,
    });
  }

  // Plugin tokens
  for (const { secretName, token } of pluginSecrets) {
    await exec("gh", ["secret", "set", secretName, "--body", token], {
      throwOnError: true,
    });
  }
}

// Hash format v2: includes plugin secrets — existing hashes will mismatch,
// prompting a one-time re-sync on upgrade. The version constant ensures
// future format changes automatically produce different hashes.
function tokensSyncHash(
  tokens: Record<string, string>,
  pluginSecrets: GhSecretEntry[] = [],
): string {
  const sorted = Object.entries(tokens).sort(([a], [b]) => a.localeCompare(b));
  const pluginSorted = [...pluginSecrets].sort((a, b) =>
    a.secretName.localeCompare(b.secretName),
  );
  return createHash("sha256")
    .update(JSON.stringify({ v: 2, sorted, pluginSorted }))
    .digest("hex")
    .slice(0, 16);
}

export async function promptGhSecretsSync(
  tokens: Record<string, string>,
  // biome-ignore lint/suspicious/noExplicitAny: runner task context type is complex and not easily typed inline
  task: any,
  pluginSecrets: GhSecretEntry[] = [],
  repoSlug: string,
  promptEnabled = true,
): Promise<void> {
  const currentHash = tokensSyncHash(tokens, pluginSecrets);
  const storedHash = readGhSecretsSyncHash(repoSlug);

  if (storedHash === currentHash) {
    task.output = t("task.preflight.syncAlreadyAcked");
    return;
  }

  if (!promptEnabled) {
    throw new PreflightError(t("error.preflight.syncRequired"));
  }

  const shouldSync = await task.prompt().run({
    type: "toggle",
    message: t("prompt.preflight.syncSecrets"),
    enabled: "Yes",
    disabled: "No",
  });

  if (shouldSync) {
    task.output = t("task.preflight.syncing");
    try {
      await syncGhSecrets(tokens, pluginSecrets);
      task.output = t("task.preflight.synced");
    } catch (error) {
      throw new PreflightError(t("error.preflight.syncFailed"), {
        cause: error,
      });
    }
  }

  try {
    writeGhSecretsSyncHash(repoSlug, currentHash);
  } catch (error) {
    throw new PreflightError(t("error.preflight.saveSyncState"), {
      cause: error,
    });
  }
}

export async function collectPluginCredentials(
  credentials: PluginCredential[],
  promptEnabled: boolean,
  // biome-ignore lint/suspicious/noExplicitAny: runner task context type is complex and not easily typed inline
  task: any,
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  const store = new SecureStore();
  const wrappedTask = wrapTaskContext(task);

  for (const credential of credentials) {
    const required = credential.required !== false;

    // 1. Check environment variable
    const envValue = process.env[credential.env];
    if (envValue) {
      if (credential.validate) {
        wrappedTask.output = t("task.preflight.validating", {
          label: credential.label,
        });
        const isValid = await credential.validate(envValue, wrappedTask);
        if (!isValid) {
          throw new PreflightError(
            t("error.preflight.envInvalid", { env: credential.env }),
          );
        }
      }
      tokens[credential.key] = envValue;
      continue;
    }

    // 2. Try custom resolver (before keyring)
    if (credential.resolve) {
      const resolved = await credential.resolve();
      if (resolved) {
        if (credential.validate) {
          wrappedTask.output = t("task.preflight.validating", {
            label: credential.label,
          });
          if (await credential.validate(resolved, wrappedTask)) {
            tokens[credential.key] = resolved;
            store.set(credential.key, resolved);
            continue;
          }
        } else {
          tokens[credential.key] = resolved;
          store.set(credential.key, resolved);
          continue;
        }
      }
    }

    // 3. Check keyring/SecureStore
    const stored = store.get(credential.key);
    if (stored) {
      if (credential.validate) {
        wrappedTask.output = t("task.preflight.validatingStored", {
          label: credential.label,
        });
        const isValid = await credential.validate(stored, wrappedTask);
        if (!isValid) {
          wrappedTask.output = t("task.preflight.storedInvalid", {
            label: credential.label,
          });
          store.delete(credential.key);
        } else {
          tokens[credential.key] = stored;
          continue;
        }
      } else {
        tokens[credential.key] = stored;
        continue;
      }
    }

    // 4. Prompt (if interactive)
    if (!promptEnabled) {
      if (required) {
        throw new PreflightError(
          t("error.preflight.envRequired", {
            label: credential.label,
            env: credential.env,
          }),
        );
      }
      continue;
    }

    // Prompt loop
    while (true) {
      wrappedTask.output = t("task.preflight.enter", {
        label: credential.label,
      });
      const tokenUrlInfo = credential.tokenUrl
        ? formatTokenUrlInfo(
            credential.tokenUrlLabel ?? credential.tokenUrl,
            credential.tokenUrl,
          )
        : "";
      const token = await wrappedTask.prompt({
        type: "password",
        message: t("task.preflight.enter", { label: credential.label }),
        ...(tokenUrlInfo ? { footer: tokenUrlInfo } : {}),
      });

      if (!`${token}`.trim()) {
        if (required) {
          throw new PreflightError(
            t("error.preflight.required", { label: credential.label }),
          );
        }
        break;
      }

      if (credential.validate) {
        wrappedTask.output = t("task.preflight.validating", {
          label: credential.label,
        });
        const isValid = await credential.validate(token as string, wrappedTask);
        if (!isValid) {
          wrappedTask.output = t("task.preflight.invalid", {
            label: credential.label,
          });
          continue;
        }
      }

      tokens[credential.key] = token as string;
      store.set(credential.key, token as string);
      break;
    }
  }

  return tokens;
}
