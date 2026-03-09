import { SecureStore } from "./secure-store.js";

export interface TokenEntry {
  envVar: string;
  dbKey: string;
  ghSecretName: string;
  promptLabel: string;
  tokenUrl: string;
  tokenUrlLabel: string;
}

export const TOKEN_CONFIG: Record<string, TokenEntry> = {
  npm: {
    envVar: "NODE_AUTH_TOKEN",
    dbKey: "npm-token",
    ghSecretName: "NODE_AUTH_TOKEN",
    promptLabel: "npm access token",
    tokenUrl:
      "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
    tokenUrlLabel: "npmjs.com",
  },
  jsr: {
    envVar: "JSR_TOKEN",
    dbKey: "jsr-token",
    ghSecretName: "JSR_TOKEN",
    promptLabel: "jsr API token",
    tokenUrl: "https://jsr.io/account/tokens/create",
    tokenUrlLabel: "jsr.io",
  },
  crates: {
    envVar: "CARGO_REGISTRY_TOKEN",
    dbKey: "cargo-token",
    ghSecretName: "CARGO_REGISTRY_TOKEN",
    promptLabel: "crates.io API token",
    tokenUrl: "https://crates.io/settings/tokens/new",
    tokenUrlLabel: "crates.io",
  },
};

export function loadTokens(registries: string[]): Record<string, string> {
  const store = new SecureStore();
  const tokens: Record<string, string> = {};

  for (const registry of registries) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

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

const NPM_AUTH_ENV_VAR = "npm_config_//registry.npmjs.org/:_authToken";

export function injectTokensToEnv(tokens: Record<string, string>): () => void {
  const originals: Record<string, string | undefined> = {};

  for (const [registry, token] of Object.entries(tokens)) {
    const config = TOKEN_CONFIG[registry];
    if (!config) continue;

    originals[config.envVar] = process.env[config.envVar];
    process.env[config.envVar] = token;

    if (registry === "npm") {
      originals[NPM_AUTH_ENV_VAR] = process.env[NPM_AUTH_ENV_VAR];
      process.env[NPM_AUTH_ENV_VAR] = token;
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
