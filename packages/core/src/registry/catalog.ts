import type { Task, TaskContext } from "@pubm/runner";
import type {
  PrivateRegistryConfig,
  ResolvedPackageConfig,
} from "../config/types.js";
import type { PubmContext } from "../context.js";
import type { EcosystemKey } from "../ecosystem/catalog.js";
import type { RegistryTaskFactory } from "../tasks/task-factory.js";
import { sortCratesByDependencyOrder } from "../utils/crate-graph.js";
import { exec } from "../utils/exec.js";
import { normalizeRegistryUrl } from "../utils/normalize-registry-url.js";
import type { RegistryConnector } from "./connector.js";
import { CratesConnector, cratesPackageRegistry } from "./crates.js";
import { jsrConnector, jsrPackageRegistry } from "./jsr.js";
import { NpmPackageRegistry, npmConnector, npmPackageRegistry } from "./npm.js";
import type { PackageRegistry } from "./package-registry.js";

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
  /** Label for rollback UI, e.g. "Unpublish" or "Yank" */
  unpublishLabel: string;
  /** If true, token is collected early in prepare phase */
  requiresEarlyAuth: boolean;
  /** Task factory for runner publish/dry-run task creation */
  taskFactory?: RegistryTaskFactory;
  /** If true, workflow-native publish/dry-run delegates to taskFactory. */
  useWorkflowTaskFactory?: boolean;
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

  keys(): string[] {
    return [...this.descriptors.keys()];
  }

  remove(key: string): boolean {
    return this.descriptors.delete(key);
  }
}

export const registryCatalog = new RegistryCatalog();

/**
 * Creates a Task wrapper that lazily imports the actual task creator
 * to break circular dependencies between catalog.ts and task modules.
 */
function lazyTask(
  title: string,
  loader: () => Promise<Task<PubmContext>>,
): Task<PubmContext> {
  return {
    title,
    task: async (ctx, task) => {
      const inner = await loader();
      if (inner.title) {
        task.title = inner.title;
      }
      if (inner.skip) {
        const skipResult = await (typeof inner.skip === "function"
          ? inner.skip(ctx)
          : inner.skip);
        if (skipResult) {
          return task.skip(
            typeof skipResult === "string" ? skipResult : undefined,
          );
        }
      }
      return (
        inner.task as (
          ctx: PubmContext,
          task: TaskContext<PubmContext>,
        ) => Promise<void>
      )(ctx, task);
    },
  };
}

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
  unpublishLabel: "Unpublish",
  requiresEarlyAuth: false,
  taskFactory: {
    createPublishTask: (packagePath) =>
      lazyTask(packagePath, async () => {
        const { createNpmPublishTask } = await import("../tasks/npm.js");
        return createNpmPublishTask(packagePath);
      }),
    createDryRunTask: (packagePath) =>
      lazyTask(packagePath, async () => {
        const { createNpmDryRunPublishTask } = await import(
          "../tasks/dry-run-publish.js"
        );
        return createNpmDryRunPublishTask(packagePath);
      }),
  },
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
  unpublishLabel: "Unpublish",
  requiresEarlyAuth: true,
  taskFactory: {
    createPublishTask: (packagePath) =>
      lazyTask(packagePath, async () => {
        const { createJsrPublishTask } = await import("../tasks/jsr.js");
        return createJsrPublishTask(packagePath);
      }),
    createDryRunTask: (packagePath) =>
      lazyTask(packagePath, async () => {
        const { createJsrDryRunPublishTask } = await import(
          "../tasks/dry-run-publish.js"
        );
        return createJsrDryRunPublishTask(packagePath);
      }),
  },
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
  validateToken: async (token) => {
    return token.trim().length >= 32;
  },
  resolveDisplayName: async (ctx) => {
    return (
      ctx.packages
        ?.filter((pkg) => pkg.registries?.includes("crates"))
        .map((pkg) => pkg.name) ?? ["crate"]
    );
  },
  concurrentPublish: false,
  unpublishLabel: "Yank",
  requiresEarlyAuth: false,
  taskFactory: {
    createPublishTask: (packagePath) =>
      lazyTask(packagePath, async () => {
        const { createCratesPublishTask } = await import("../tasks/crates.js");
        return createCratesPublishTask(packagePath);
      }),
    createDryRunTask: (packagePath, siblingPaths) =>
      lazyTask(`Dry-run crates.io publish (${packagePath})`, async () => {
        const { createCratesDryRunPublishTask } = await import(
          "../tasks/dry-run-publish.js"
        );
        return createCratesDryRunPublishTask(packagePath, siblingPaths);
      }),
  },
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
    concurrentPublish: true,
    unpublishLabel: "Unpublish",
    requiresEarlyAuth: false,
    taskFactory: {
      createPublishTask: (packagePath) =>
        lazyTask(packagePath, async () => {
          const { createNpmPublishTask } = await import("../tasks/npm.js");
          return createNpmPublishTask(packagePath);
        }),
      createDryRunTask: (packagePath) =>
        lazyTask(packagePath, async () => {
          const { createNpmDryRunPublishTask } = await import(
            "../tasks/dry-run-publish.js"
          );
          return createNpmDryRunPublishTask(packagePath);
        }),
    },
    connector: () => npmConnector(),
    factory: async (packagePath) => {
      // Lazy import to break circular dependency:
      // npm.ts -> catalog.ts -> custom-registry.ts -> npm.ts
      const { CustomPackageRegistry } = await import("./custom-registry.js");
      const manifest = await NpmPackageRegistry.reader.read(packagePath);
      return new CustomPackageRegistry(manifest.name, packagePath, config.url);
    },
  });

  return key;
}
