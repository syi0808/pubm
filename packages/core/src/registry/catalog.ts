import type { PackageConfig } from "../config/types.js";
import { exec } from "../utils/exec.js";
import { getJsrJson, getPackageJson } from "../utils/package.js";
import { cratesRegistry } from "./crates.js";
import { jsrRegistry } from "./jsr.js";
import { npmRegistry } from "./npm.js";
import type { Registry } from "./registry.js";

export type EcosystemKey = "js" | "rust" | string;

export interface TokenEntry {
  envVar: string;
  dbKey: string;
  ghSecretName: string;
  promptLabel: string;
  tokenUrl: string;
  tokenUrlLabel: string;
}

export interface RegistryDescriptor {
  key: string;
  ecosystem: EcosystemKey;
  label: string;
  tokenConfig: TokenEntry;
  needsPackageScripts: boolean;
  additionalEnvVars?: (token: string) => Record<string, string>;
  resolveTokenUrl?: (baseUrl: string) => Promise<string>;
  resolveDisplayName?: (ctx: {
    packages?: PackageConfig[];
  }) => Promise<string[]>;
  factory: (packageName?: string) => Promise<Registry>;
}

export class RegistryCatalog {
  private descriptors = new Map<string, RegistryDescriptor>();

  register(descriptor: RegistryDescriptor): void {
    this.descriptors.set(descriptor.key, descriptor);
  }

  get(key: string): RegistryDescriptor | undefined {
    return this.descriptors.get(key);
  }

  getByEcosystem(ecosystem: EcosystemKey): RegistryDescriptor[] {
    return [...this.descriptors.values()].filter(
      (d) => d.ecosystem === ecosystem,
    );
  }

  all(): RegistryDescriptor[] {
    return [...this.descriptors.values()];
  }
}

export const registryCatalog = new RegistryCatalog();

registryCatalog.register({
  key: "npm",
  ecosystem: "js",
  label: "npm",
  tokenConfig: {
    envVar: "NODE_AUTH_TOKEN",
    dbKey: "npm-token",
    ghSecretName: "NODE_AUTH_TOKEN",
    promptLabel: "npm access token",
    tokenUrl:
      "https://www.npmjs.com/settings/~/tokens/granular-access-tokens/new",
    tokenUrlLabel: "npmjs.com",
  },
  needsPackageScripts: true,
  additionalEnvVars: (token) => ({
    "npm_config_//registry.npmjs.org/:_authToken": token,
  }),
  resolveTokenUrl: async (baseUrl) => {
    if (!baseUrl.includes("~")) return baseUrl;
    const result = await exec("npm", ["whoami"]);
    const username = result.stdout.trim();
    return username ? baseUrl.replace("~", username) : baseUrl;
  },
  resolveDisplayName: async () => {
    const pkg = await getPackageJson();
    return pkg.name ? [pkg.name] : [];
  },
  factory: () => npmRegistry(),
});

registryCatalog.register({
  key: "jsr",
  ecosystem: "js",
  label: "jsr",
  tokenConfig: {
    envVar: "JSR_TOKEN",
    dbKey: "jsr-token",
    ghSecretName: "JSR_TOKEN",
    promptLabel: "jsr API token",
    tokenUrl: "https://jsr.io/account/tokens/create",
    tokenUrlLabel: "jsr.io",
  },
  needsPackageScripts: false,
  resolveDisplayName: async () => {
    const jsr = await getJsrJson();
    return jsr.name ? [jsr.name] : [];
  },
  factory: () => jsrRegistry(),
});

registryCatalog.register({
  key: "crates",
  ecosystem: "rust",
  label: "crates.io",
  tokenConfig: {
    envVar: "CARGO_REGISTRY_TOKEN",
    dbKey: "cargo-token",
    ghSecretName: "CARGO_REGISTRY_TOKEN",
    promptLabel: "crates.io API token",
    tokenUrl: "https://crates.io/settings/tokens/new",
    tokenUrlLabel: "crates.io",
  },
  needsPackageScripts: false,
  resolveDisplayName: async (ctx) => {
    return (
      ctx.packages
        ?.filter((pkg) => pkg.registries?.includes("crates"))
        .map((pkg) => pkg.path) ?? ["crate"]
    );
  },
  factory: (name) => cratesRegistry(name ?? "unknown"),
});
