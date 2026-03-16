import type {
  PrivateRegistryConfig,
  ResolvedPackageConfig,
} from "../config/types.js";
import { sortCratesByDependencyOrder } from "../utils/crate-graph.js";
import { exec } from "../utils/exec.js";
import { normalizeRegistryUrl } from "../utils/normalize-registry-url.js";
import type { RegistryConnector } from "./connector.js";
import { CratesConnector, cratesPackageRegistry } from "./crates.js";
import { CustomPackageRegistry } from "./custom-registry.js";
import { jsrConnector, jsrPackageRegistry } from "./jsr.js";
import { NpmPackageRegistry, npmConnector, npmPackageRegistry } from "./npm.js";
import type { PackageRegistry } from "./package-registry.js";

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
  validateToken?: (token: string) => Promise<boolean>;
  resolveTokenUrl?: (baseUrl: string) => Promise<string>;
  resolveDisplayName?: (ctx: {
    packages?: ResolvedPackageConfig[];
  }) => Promise<string[]>;
  concurrentPublish: boolean;
  orderPackages?: (paths: string[]) => Promise<string[]>;
  connector: () => RegistryConnector;
  factory: (packagePath: string) => Promise<PackageRegistry>;
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
  validateToken: async (token) => {
    const res = await fetch("https://registry.npmjs.org/-/whoami", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  },
  resolveTokenUrl: async (baseUrl) => {
    if (!baseUrl.includes("~")) return baseUrl;
    const result = await exec("npm", ["whoami"]);
    const username = result.stdout.trim();
    return username ? baseUrl.replace("~", username) : baseUrl;
  },
  resolveDisplayName: async (ctx) => {
    return (
      ctx.packages
        ?.filter((pkg) => pkg.registries?.includes("npm"))
        .map((pkg) => pkg.name) ?? []
    );
  },
  concurrentPublish: true,
  connector: () => npmConnector(),
  factory: (packagePath) => npmPackageRegistry(packagePath),
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
  validateToken: async (token) => {
    const res = await fetch("https://jsr.io/api/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  },
  resolveDisplayName: async (ctx) => {
    return (
      ctx.packages
        ?.filter((pkg) => pkg.registries?.includes("jsr"))
        .map((pkg) => pkg.name) ?? []
    );
  },
  concurrentPublish: true,
  connector: () => jsrConnector(),
  factory: (packagePath) => jsrPackageRegistry(packagePath),
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
  validateToken: async (token) => {
    const res = await fetch("https://crates.io/api/v1/me", {
      headers: {
        Authorization: token,
        "User-Agent": "pubm (https://github.com/syi0808/pubm)",
      },
    });
    return res.ok;
  },
  resolveDisplayName: async (ctx) => {
    return (
      ctx.packages
        ?.filter((pkg) => pkg.registries?.includes("crates"))
        .map((pkg) => pkg.path) ?? ["crate"]
    );
  },
  concurrentPublish: false,
  orderPackages: (paths) => sortCratesByDependencyOrder(paths),
  connector: () => new CratesConnector(),
  factory: (name) => cratesPackageRegistry(name),
});

export function registerPrivateRegistry(
  config: PrivateRegistryConfig,
  ecosystemKey: EcosystemKey,
  catalog: RegistryCatalog = registryCatalog,
): string {
  const key = normalizeRegistryUrl(config.url);

  if (catalog.get(key)) return key; // Already registered

  catalog.register({
    key,
    ecosystem: ecosystemKey,
    label: config.url,
    tokenConfig: {
      envVar: config.token.envVar,
      dbKey: `${key}-token`,
      ghSecretName: config.token.envVar,
      promptLabel: `Token for ${config.url}`,
      tokenUrl: config.url,
      tokenUrlLabel: key,
    },
    needsPackageScripts: false,
    concurrentPublish: true,
    connector: () => npmConnector(),
    factory: async (packagePath) => {
      const manifest = await NpmPackageRegistry.reader.read(packagePath);
      return new CustomPackageRegistry(manifest.name, config.url);
    },
  });

  return key;
}
