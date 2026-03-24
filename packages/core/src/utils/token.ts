import type { PluginCredential } from "../plugin/types.js";
import { registryCatalog } from "../registry/catalog.js";
import { SecureStore } from "./secure-store.js";

// Re-export TokenEntry type from catalog for backward compat
export type { TokenEntry } from "../registry/catalog.js";

export function loadTokens(registries: string[]): Record<string, string> {
  const store = new SecureStore();
  const tokens: Record<string, string> = {};

  for (const registry of registries) {
    const descriptor = registryCatalog.get(registry);
    if (!descriptor) continue;
    const config = descriptor.tokenConfig;

    const envValue = process.env[config.envVar];
    if (envValue) {
      tokens[registry] = envValue;
      continue;
    }

    const stored = store.get(config.dbKey);
    if (stored) tokens[registry] = stored;
  }

  return tokens;
}

export const loadTokensFromDb = loadTokens;

export function injectTokensToEnv(tokens: Record<string, string>): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [registryKey, token] of Object.entries(tokens)) {
    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor) continue;

    const config = descriptor.tokenConfig;
    originals[config.envVar] = process.env[config.envVar];
    process.env[config.envVar] = token;

    const extraVars = descriptor.additionalEnvVars?.(token) ?? {};
    for (const [envVar, value] of Object.entries(extraVars)) {
      originals[envVar] = process.env[envVar];
      process.env[envVar] = value;
    }
  }

  return () => {
    for (const [envVar, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = original;
      }
    }
  };
}

export function injectPluginTokensToEnv(
  pluginTokens: Record<string, string>,
  credentials: PluginCredential[],
): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const credential of credentials) {
    const token = pluginTokens[credential.key];
    if (!token) continue;

    originals[credential.env] = process.env[credential.env];
    process.env[credential.env] = token;
  }

  return () => {
    for (const [envVar, original] of Object.entries(originals)) {
      if (original === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = original;
      }
    }
  };
}
