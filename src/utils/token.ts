import { Db } from "./db.js";

export interface TokenEntry {
  envVar: string;
  dbKey: string;
  ghSecretName: string;
  promptLabel: string;
}

export const TOKEN_CONFIG: Record<string, TokenEntry> = {
  npm: {
    envVar: "NODE_AUTH_TOKEN",
    dbKey: "npm-token",
    ghSecretName: "NODE_AUTH_TOKEN",
    promptLabel: "npm access token",
  },
  jsr: {
    envVar: "JSR_TOKEN",
    dbKey: "jsr-token",
    ghSecretName: "JSR_TOKEN",
    promptLabel: "jsr API token",
  },
  crates: {
    envVar: "CARGO_REGISTRY_TOKEN",
    dbKey: "cargo-token",
    ghSecretName: "CARGO_REGISTRY_TOKEN",
    promptLabel: "crates.io API token",
  },
};

export function loadTokensFromDb(registries: string[]): Record<string, string> {
  const db = new Db();
  const tokens: Record<string, string> = {};

  for (const registry of registries) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

    const token = db.get(config.dbKey);
    if (token) tokens[registry] = token;
  }

  return tokens;
}

export function injectTokensToEnv(tokens: Record<string, string>): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [registry, token] of Object.entries(tokens)) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

    originals[config.envVar] = process.env[config.envVar];
    process.env[config.envVar] = token;
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
