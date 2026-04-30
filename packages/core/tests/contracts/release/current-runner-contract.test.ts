import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext } from "../../../src/context.js";
import { RollbackTracker } from "../../../src/utils/rollback.js";
import type {
  ReleaseBehaviorScenario,
  ReleaseScenarioPackage,
  SemanticLedger,
  SemanticSideEffect,
} from "./contract-types.js";
import { releaseBehaviorScenarios } from "./scenarios.js";

interface ContractWorld {
  root: string;
  isCI: boolean;
  failAt?: string;
  sigintAfter?: string;
  pushSucceeds: boolean;
  githubToken: boolean;
  promptResponses: unknown[];
  releaseAssets: { name: string; filePath: string; sha256: string }[];
  initialVersions: Map<string, string>;
  ledger: SemanticLedger;
  git: {
    commits: string[];
    localTags: Set<string>;
    remoteTags: Set<string>;
    branches: Set<string>;
    pushed: boolean;
    pullRequest?: { number: number; branch: string; closed: boolean };
    releases: Map<string, { tag: string; deleted: boolean }>;
  };
  registry: {
    published: Map<string, string>;
    unpublished: string[];
  };
}

const mockState = vi.hoisted(() => {
  const state = {
    isCI: false,
    world: undefined as ContractWorld | undefined,
    runnerSigintHandler: undefined as undefined | (() => void | Promise<void>),
    sigintSkipConfirmTarget: undefined as string | undefined,
  };

  const toPosix = (value: string) => value.replace(/\\/g, "/");

  const currentWorld = () => {
    if (!state.world) throw new Error("Contract world is not initialized.");
    return state.world;
  };

  const recordSideEffect = (effect: SemanticSideEffect) => {
    currentWorld().ledger.sideEffects.push({
      ...effect,
      target: toPosix(effect.target),
    });
  };

  const packageForKey = (ctx: any, key: string) =>
    ctx.config.packages.find(
      (pkg: { path: string; ecosystem: string }) =>
        `${pkg.path}::${pkg.ecosystem}` === key,
    );

  const versionForKey = (ctx: any, key: string): string => {
    const plan = ctx.runtime.versionPlan;
    if (!plan) return "";
    if (plan.mode === "single") return plan.version;
    if (plan.mode === "fixed") return plan.version;
    return plan.packages.get(key) ?? "";
  };

  const semanticRegistryTarget = (ctx: any, registry: string, key: string) => {
    const version = versionForKey(ctx, key);
    const pkg = packageForKey(ctx, key);
    return `${registry}:${pkg?.name ?? key}@${version}`;
  };

  const runTaskList = async (tasks: any[], ctx: any): Promise<void> => {
    for (const task of tasks) {
      const enabled =
        typeof task.enabled === "function"
          ? await task.enabled(ctx)
          : task.enabled;
      if (enabled === false) continue;

      const wrapper = {
        title: task.title ?? "",
        output: "",
        skip: vi.fn((reason?: string) => {
          currentWorld().ledger.events.push({
            name: "step.skipped",
            target: task.title ?? "",
            detail: reason,
          });
        }),
        prompt: vi.fn(() => ({
          run: vi.fn(async (options: Record<string, unknown>) => {
            const world = currentWorld();
            const response =
              world.promptResponses.length > 0
                ? world.promptResponses.shift()
                : "";
            const promptRecord = {
              name: "prompt.requested",
              target: task.title ?? "",
              type: typeof options.type === "string" ? options.type : undefined,
              message:
                typeof options.message === "string"
                  ? options.message
                  : undefined,
              response,
            };
            currentWorld().ledger.prompts.push({
              ...promptRecord,
            });
            if (
              response &&
              typeof response === "object" &&
              "throws" in response
            ) {
              currentWorld().ledger.prompts[
                currentWorld().ledger.prompts.length - 1
              ] = {
                ...promptRecord,
                cancelled: true,
              };
              throw new Error(String((response as { throws: unknown }).throws));
            }
            return response;
          }),
        })),
        newListr: vi.fn((subtasks: any[]) => ({
          run: async (innerCtx: any = ctx) => runTaskList(subtasks, innerCtx),
        })),
      };

      const skip =
        typeof task.skip === "function" ? await task.skip(ctx) : task.skip;
      if (skip) {
        wrapper.skip(typeof skip === "string" ? skip : undefined);
        continue;
      }

      currentWorld().ledger.events.push({
        name: "step.started",
        target: task.title ?? "",
      });
      const result = task.task ? await task.task(ctx, wrapper) : undefined;
      if (result && typeof result.run === "function") {
        await result.run(ctx);
      }
      currentWorld().ledger.events.push({
        name: "step.completed",
        target: task.title ?? "",
      });
    }
  };

  return {
    state,
    currentWorld,
    packageForKey,
    recordSideEffect,
    runTaskList,
    semanticRegistryTarget,
    toPosix,
    versionForKey,
  };
});

vi.mock("std-env", () => ({
  get isCI() {
    return mockState.state.isCI;
  },
}));

vi.mock("@pubm/runner", () => ({
  createCiRunnerOptions: vi.fn(() => ({ renderer: "ci" })),
  createTaskRunner: vi.fn((tasks: any[]) => ({
    run: async (ctx: any) =>
      mockState.runTaskList(Array.isArray(tasks) ? tasks : [tasks], ctx),
  })),
  prompt: vi.fn(async (options: Record<string, unknown>) => {
    const world = mockState.currentWorld();
    const response =
      world.promptResponses.length > 0 ? world.promptResponses.shift() : "";
    const promptRecord = {
      name: "prompt.requested",
      target: "workflow.prompt",
      type: typeof options.type === "string" ? options.type : undefined,
      message:
        typeof options.message === "string" ? options.message : undefined,
      response,
    };
    world.ledger.prompts.push({
      ...promptRecord,
    });
    if (response && typeof response === "object" && "throws" in response) {
      world.ledger.prompts[world.ledger.prompts.length - 1] = {
        ...promptRecord,
        cancelled: true,
      };
      throw new Error(String((response as { throws: unknown }).throws));
    }
    return response;
  }),
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../src/utils/ui.js", () => ({
  ui: {
    badge: (s: string) => s,
    isDebug: () => false,
    link: (_label: string, url: string) => url,
    labels: { WARNING: "WARNING" },
    badges: { ERROR: "ERROR", ROLLBACK: "ROLLBACK" },
    chalk: {
      bold: (s: string) => s,
      blueBright: (s: string) => s,
      cyan: (s: string) => s,
      dim: (s: string) => s,
      green: (s: string) => s,
      red: (s: string) => s,
      underline: (s: string) => s,
      yellow: (s: string) => s,
    },
  },
}));

vi.mock("../../../src/utils/listr.js", () => ({
  createCiListrOptions: vi.fn(() => ({ renderer: "ci" })),
  createListr: vi.fn((tasks: any[]) => ({
    run: async (ctx: any) =>
      mockState.runTaskList(Array.isArray(tasks) ? tasks : [tasks], ctx),
  })),
}));

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(
    async (
      cmd: string,
      args: string[],
      options?: { nodeOptions?: { cwd?: string } },
    ) => {
      mockState.recordSideEffect({
        kind: "command.exec",
        target: [cmd, ...args].join(" "),
        detail: { cwd: options?.nodeOptions?.cwd },
      });
      return { stdout: "", stderr: "", code: 0 };
    },
  ),
}));

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(() => []),
}));

vi.mock("../../../src/ecosystem/catalog.js", async () => {
  const fs = await import("node:fs");
  const nodePath = await import("node:path");

  class MockJsEcosystem {
    packagePath: string;

    constructor(packagePath: string) {
      this.packagePath = packagePath;
    }

    manifestFiles(): string[] {
      return ["package.json", "jsr.json"].filter((file) =>
        fs.existsSync(nodePath.join(this.packagePath, file)),
      );
    }

    registryClasses() {
      return [{ reader: { invalidate: vi.fn() } }];
    }

    async packageName(): Promise<string> {
      const manifest = JSON.parse(
        fs.readFileSync(
          nodePath.join(this.packagePath, "package.json"),
          "utf-8",
        ),
      );
      return manifest.name;
    }

    async writeVersion(version: string): Promise<void> {
      for (const manifestFile of this.manifestFiles()) {
        const manifestPath = nodePath.join(this.packagePath, manifestFile);
        const relativePath = mockState.toPosix(
          nodePath.relative(mockState.currentWorld().root, manifestPath),
        );
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        manifest.version = version;
        fs.writeFileSync(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          "utf-8",
        );
        const kind =
          mockState.currentWorld().initialVersions.get(relativePath) === version
            ? "manifest.restore"
            : "manifest.write";
        mockState.recordSideEffect({
          kind,
          target: relativePath,
          detail: { version },
        });
      }
    }

    async updateSiblingDependencyVersions(): Promise<void> {}

    async syncLockfile(): Promise<undefined> {
      return undefined;
    }

    async resolvePublishDependencies(): Promise<Map<string, string>> {
      return new Map();
    }

    async resolveTestCommand(script: string) {
      return { cmd: "bun", args: ["run", script] };
    }

    async resolveBuildCommand(script: string) {
      return { cmd: "bun", args: ["run", script] };
    }

    async validateScript() {
      return undefined;
    }
  }

  class MockRustEcosystem {
    packagePath: string;

    constructor(packagePath: string) {
      this.packagePath = packagePath;
    }

    manifestFiles(): string[] {
      return ["Cargo.toml"].filter((file) =>
        fs.existsSync(nodePath.join(this.packagePath, file)),
      );
    }

    registryClasses() {
      return [{ reader: { invalidate: vi.fn() } }];
    }

    async packageName(): Promise<string> {
      const cargo = fs.readFileSync(
        nodePath.join(this.packagePath, "Cargo.toml"),
        "utf-8",
      );
      return (
        cargo.match(/name = "([^"]+)"/)?.[1] ??
        nodePath.basename(this.packagePath)
      );
    }

    async writeVersion(version: string): Promise<void> {
      const manifestPath = nodePath.join(this.packagePath, "Cargo.toml");
      const relativePath = mockState.toPosix(
        nodePath.relative(mockState.currentWorld().root, manifestPath),
      );
      const next = fs
        .readFileSync(manifestPath, "utf-8")
        .replace(/version = "[^"]+"/, `version = "${version}"`);
      fs.writeFileSync(manifestPath, next, "utf-8");
      const kind =
        mockState.currentWorld().initialVersions.get(relativePath) === version
          ? "manifest.restore"
          : "manifest.write";
      mockState.recordSideEffect({
        kind,
        target: relativePath,
        detail: { version },
      });
    }

    async updateSiblingDependencyVersions(): Promise<void> {}

    async syncLockfile(): Promise<undefined> {
      return undefined;
    }

    async resolvePublishDependencies(): Promise<Map<string, string>> {
      return new Map();
    }

    async resolveTestCommand(script: string) {
      return { cmd: "cargo", args: script.split(" ") };
    }

    async resolveBuildCommand(script: string) {
      return { cmd: "cargo", args: script.split(" ") };
    }

    async validateScript() {
      return undefined;
    }
  }

  const descriptors = {
    js: { key: "js", label: "JavaScript", ecosystemClass: MockJsEcosystem },
    rust: { key: "rust", label: "Rust", ecosystemClass: MockRustEcosystem },
  };

  return {
    ecosystemCatalog: {
      get: vi.fn((key: "js" | "rust") => descriptors[key]),
      all: vi.fn(() => Object.values(descriptors)),
      register: vi.fn(),
    },
  };
});

vi.mock("../../../src/registry/catalog.js", async () => {
  const fs = await import("node:fs");
  const nodePath = await import("node:path");

  function manifestVersionForKey(ctx: any, key: string): string {
    const pkg = mockState.packageForKey(ctx, key);
    if (!pkg) return mockState.versionForKey(ctx, key);

    const packageDir = nodePath.join(mockState.currentWorld().root, pkg.path);
    if (pkg.ecosystem === "rust") {
      return (
        fs
          .readFileSync(nodePath.join(packageDir, "Cargo.toml"), "utf-8")
          .match(/version = "([^"]+)"/)?.[1] ??
        mockState.versionForKey(ctx, key)
      );
    }

    const manifest = JSON.parse(
      fs.readFileSync(nodePath.join(packageDir, "package.json"), "utf-8"),
    );
    return manifest.version ?? mockState.versionForKey(ctx, key);
  }

  function createRegistryTask(registry: string, key: string, dryRun: boolean) {
    return {
      title: `${dryRun ? "Dry-run" : "Publish"} ${registry} ${key}`,
      task: async (ctx: any, _task: { skip: (reason?: string) => void }) => {
        const pkg = mockState.packageForKey(ctx, key);
        const version = manifestVersionForKey(ctx, key);
        const target = `${registry}:${pkg?.name ?? key}@${version}`;

        if (dryRun) {
          mockState.recordSideEffect({
            kind: "registry.dryRun",
            target,
            detail: { tag: ctx.runtime.tag, version },
          });
          return;
        }

        if (mockState.currentWorld().failAt === `registry.publish:${target}`) {
          throw new Error(`Injected failure at ${target}`);
        }

        mockState.currentWorld().registry.published.set(target, version);
        mockState.recordSideEffect({
          kind: "registry.publish",
          target,
          detail: { tag: ctx.runtime.tag, version },
        });

        const rollbackKind =
          registry === "crates" ? "registry.yank" : "registry.unpublish";
        const rollbackLabel =
          registry === "crates" ? `yank ${target}` : `unpublish ${target}`;
        ctx.runtime.rollback.add({
          label: rollbackLabel,
          fn: async () => {
            mockState.currentWorld().registry.published.delete(target);
            mockState.currentWorld().registry.unpublished.push(target);
            mockState.recordSideEffect({ kind: rollbackKind, target });
          },
          confirm: true,
        });

        if (
          mockState.currentWorld().sigintAfter === `registry.publish:${target}`
        ) {
          await mockState.state.runnerSigintHandler?.();
        }
      },
    };
  }

  function packageNameForPath(packagePath: string): string {
    const packageDir = nodePath.join(
      mockState.currentWorld().root,
      packagePath,
    );
    const packageJsonPath = nodePath.join(packageDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")).name;
    }

    const cargo = fs.readFileSync(
      nodePath.join(packageDir, "Cargo.toml"),
      "utf-8",
    );
    return cargo.match(/name = "([^"]+)"/)?.[1] ?? packagePath;
  }

  function manifestVersionForPath(packagePath: string): string {
    const packageDir = nodePath.join(
      mockState.currentWorld().root,
      packagePath,
    );
    const packageJsonPath = nodePath.join(packageDir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")).version;
    }

    const cargo = fs.readFileSync(
      nodePath.join(packageDir, "Cargo.toml"),
      "utf-8",
    );
    return cargo.match(/version = "([^"]+)"/)?.[1] ?? "";
  }

  function registryTarget(
    registry: string,
    packagePath: string,
    version: string,
  ): string {
    return `${registry}:${packageNameForPath(packagePath)}@${version}`;
  }

  function createPackageRegistry(registry: string, packagePath: string) {
    const publishToRegistry = async (tag = "latest") => {
      const version = manifestVersionForPath(packagePath);
      const target = registryTarget(registry, packagePath, version);

      if (mockState.currentWorld().failAt === `registry.publish:${target}`) {
        throw new Error(`Injected failure at ${target}`);
      }

      mockState.currentWorld().registry.published.set(target, version);
      mockState.recordSideEffect({
        kind: "registry.publish",
        target,
        detail: { tag, version },
      });

      return true;
    };

    const registryObject: Record<string, unknown> = {
      packageName: packageNameForPath(packagePath),
      packagePath,
      registry,
      supportsUnpublish: registry !== "jsr",
      isVersionPublished: vi.fn(async (version: string) =>
        mockState
          .currentWorld()
          .registry.published.has(
            registryTarget(registry, packagePath, version),
          ),
      ),
      isPublished: vi.fn(async () => false),
      hasPermission: vi.fn(async () => true),
      isPackageNameAvailable: vi.fn(async () => true),
      distTags: vi.fn(async () => []),
      getRequirements: vi.fn(() => ({ requiredManifest: "manifest" })),
      checkAvailability: vi.fn(async () => undefined),
      publish: vi.fn(async (first?: string, second?: string) =>
        publishToRegistry(second ?? first ?? "latest"),
      ),
      dryRunPublish: vi.fn(async (tag = "latest") => {
        const version = manifestVersionForPath(packagePath);
        mockState.recordSideEffect({
          kind: "registry.dryRun",
          target: registryTarget(registry, packagePath, version),
          detail: { tag, version },
        });
      }),
      unpublish: vi.fn(async (_name: string, version: string) => {
        const target = registryTarget(registry, packagePath, version);
        mockState.currentWorld().registry.published.delete(target);
        mockState.currentWorld().registry.unpublished.push(target);
        mockState.recordSideEffect({
          kind: registry === "crates" ? "registry.yank" : "registry.unpublish",
          target,
        });
      }),
    };

    if (registry !== "jsr" && registry !== "crates") {
      registryObject.publishProvenance = vi.fn(async (tag = "latest") =>
        publishToRegistry(tag),
      );
    }

    return registryObject;
  }

  const descriptor = (
    key: string,
    ecosystem: "js" | "rust",
    label: string,
  ) => ({
    key,
    ecosystem,
    label,
    tokenConfig: {
      envVar:
        key === "npm"
          ? "NODE_AUTH_TOKEN"
          : key === "crates"
            ? "CARGO_REGISTRY_TOKEN"
            : `${key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_TOKEN`,
      dbKey: `${key}-token`,
      ghSecretName: `${key.toUpperCase()}_TOKEN`,
      promptLabel: `${key} token`,
      tokenUrl: "https://example.test/token",
      tokenUrlLabel: "example",
    },
    concurrentPublish: key !== "crates",
    unpublishLabel: key === "crates" ? "Yank" : "Unpublish",
    requiresEarlyAuth: key === "jsr",
    orderPackages:
      key === "crates"
        ? vi.fn(async (keys: string[]) => [...keys].sort())
        : undefined,
    taskFactory: {
      createPublishTask: (packageKey: string) =>
        createRegistryTask(key, packageKey, false),
      createDryRunTask: (packageKey: string) =>
        createRegistryTask(key, packageKey, true),
    },
    resolveDisplayName: async (ctx: {
      packages?: { registries: string[]; name: string }[];
    }) =>
      ctx.packages
        ?.filter((pkg) => pkg.registries.includes(key))
        .map((pkg) => pkg.name) ?? [],
    connector: vi.fn(() => ({ ping: vi.fn(async () => undefined) })),
    factory: vi.fn((packagePath: string) =>
      Promise.resolve(createPackageRegistry(key, packagePath)),
    ),
  });

  const descriptors = new Map([
    ["npm", descriptor("npm", "js", "npm")],
    ["jsr", descriptor("jsr", "js", "jsr")],
    ["crates", descriptor("crates", "rust", "crates.io")],
    [
      "registry.internal.test/npm",
      descriptor(
        "registry.internal.test/npm",
        "js",
        "https://registry.internal.test/npm",
      ),
    ],
  ]);

  return {
    registryCatalog: {
      get: vi.fn((key: string) => descriptors.get(key)),
      all: vi.fn(() => [...descriptors.values()]),
      keys: vi.fn(() => [...descriptors.keys()]),
      register: vi.fn((desc: { key: string }) =>
        descriptors.set(desc.key, desc),
      ),
      remove: vi.fn((key: string) => descriptors.delete(key)),
    },
  };
});

vi.mock("../../../src/workflow/release-phases/preflight.js", () => ({
  runLocalPreflight: vi.fn(async () => {
    mockState.currentWorld().ledger.events.push({ name: "preflight.local" });
  }),
  runCiPreparePreflight: vi.fn(async () => {
    mockState
      .currentWorld()
      .ledger.events.push({ name: "preflight.ciPrepare" });
  }),
  runCiPublishPluginCreds: vi.fn(async () => {
    mockState
      .currentWorld()
      .ledger.events.push({ name: "preflight.ciPublish" });
  }),
}));

vi.mock("../../../src/tasks/prerequisites-check.js", () => ({
  prerequisitesCheckTask: vi.fn(() => ({
    run: async () => {
      mockState
        .currentWorld()
        .ledger.events.push({ name: "preflight.prerequisites" });
    },
  })),
}));

vi.mock("../../../src/tasks/required-conditions-check.js", () => ({
  requiredConditionsCheckTask: vi.fn(() => ({
    run: async () => {
      mockState
        .currentWorld()
        .ledger.events.push({ name: "preflight.conditions" });
    },
  })),
}));

vi.mock("../../../src/tasks/github-release.js", () => ({
  createGitHubRelease: vi.fn(
    async (
      _ctx: unknown,
      input: {
        tag: string;
        displayLabel: string;
        version: string;
        draft?: boolean;
        assets?: { name: string; sha256: string }[];
      },
    ) => {
      const failAt = mockState.currentWorld().failAt;
      if (failAt === `github.release:${input.tag}`) {
        throw new Error(`Injected GitHub release failure at ${input.tag}`);
      }

      const releaseId = `release-${input.tag}`;
      mockState.currentWorld().git.releases.set(releaseId, {
        tag: input.tag,
        deleted: false,
      });
      mockState.currentWorld().ledger.releaseRequests.push({
        kind: "create",
        target: input.tag,
        detail: {
          displayLabel: input.displayLabel,
          version: input.version,
          draft: !!input.draft,
          assets: input.assets?.map((asset) => ({
            name: asset.name,
            sha256: asset.sha256,
          })),
        },
      });
      mockState.recordSideEffect({
        kind: "github.release",
        target: input.tag,
        detail: {
          displayLabel: input.displayLabel,
          version: input.version,
          draft: !!input.draft,
          assets: input.assets?.map((asset) => ({
            name: asset.name,
            sha256: asset.sha256,
          })),
        },
      });

      if (failAt === `github.assetUpload:${input.tag}`) {
        const release = mockState.currentWorld().git.releases.get(releaseId);
        if (release) release.deleted = true;
        mockState.currentWorld().ledger.releaseRequests.push({
          kind: "delete",
          target: releaseId,
        });
        mockState.recordSideEffect({
          kind: "github.release.delete",
          target: releaseId,
        });
        throw new Error(`Injected GitHub asset upload failure at ${input.tag}`);
      }

      return {
        displayLabel: input.displayLabel,
        version: input.version,
        tag: input.tag,
        releaseId,
        releaseUrl: `https://github.test/releases/${input.tag}`,
        assets:
          input.assets?.map((asset) => ({
            name: asset.name,
            url: `https://github.test/downloads/${asset.name}`,
            sha256: asset.sha256,
          })) ?? [],
      };
    },
  ),
  deleteGitHubRelease: vi.fn(async (releaseId: string) => {
    const release = mockState.currentWorld().git.releases.get(releaseId);
    if (release) release.deleted = true;
    mockState.currentWorld().ledger.releaseRequests.push({
      kind: "delete",
      target: releaseId,
    });
    mockState.recordSideEffect({
      kind: "github.release.delete",
      target: releaseId,
    });
  }),
}));

vi.mock("../../../src/assets/pipeline.js", () => ({
  runAssetPipeline: vi.fn(async () => mockState.currentWorld().releaseAssets),
}));

vi.mock("../../../src/assets/resolver.js", () => ({
  normalizeConfig: vi.fn(() => [{ files: [] }]),
  resolveAssets: vi.fn(() => []),
}));

vi.mock("../../../src/changeset/reader.js", () => ({
  readChangesets: vi.fn(() => []),
  deleteChangesetFiles: vi.fn(
    (_cwd: string, changesets: { filePath?: string }[]) => {
      mockState
        .currentWorld()
        .ledger.changesetState.consumed.push(
          ...changesets.map((item) => mockState.toPosix(item.filePath ?? "")),
        );
    },
  ),
}));

vi.mock("../../../src/changeset/changelog.js", () => ({
  buildChangelogEntries: vi.fn(() => []),
  deduplicateEntries: vi.fn((entries: unknown[]) => entries),
  generateChangelog: vi.fn(() => ""),
  writeChangelogToFile: vi.fn((cwd: string, content: string) => {
    mockState.currentWorld().ledger.changesetState.changelogs.push({
      path: mockState.toPosix(cwd),
      summary: content.split("\n")[0] ?? "",
    });
  }),
}));

vi.mock("../../../src/changeset/resolve.js", () => ({
  createKeyResolver: vi.fn(() => (value: string) => value),
}));

vi.mock("../../../src/utils/github-token.js", () => ({
  resolveGitHubToken: vi.fn(() => {
    if (mockState.currentWorld().githubToken === false) return null;
    return { token: "gh-token", source: "env" };
  }),
  saveGitHubToken: vi.fn(),
}));

vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(async (url: string) => {
    const parsed = new URL(url);
    mockState.recordSideEffect({
      kind: "browser.open",
      target: `${parsed.origin}${parsed.pathname}`,
      detail: {
        tag: parsed.searchParams.get("tag"),
        prerelease: parsed.searchParams.get("prerelease"),
      },
    });
  }),
}));

vi.mock("../../../src/tasks/create-version-pr.js", () => ({
  createVersionPr: vi.fn(async (input: { branch: string }) => {
    if (
      mockState.currentWorld().failAt === `github.pr.create:${input.branch}`
    ) {
      throw new Error(`Injected version PR failure at ${input.branch}`);
    }
    const pr = { number: 42, url: "https://github.test/pull/42" };
    mockState.currentWorld().git.pullRequest = {
      number: pr.number,
      branch: input.branch,
      closed: false,
    };
    mockState.recordSideEffect({
      kind: "github.pr.create",
      target: input.branch,
      detail: { number: pr.number },
    });
    return pr;
  }),
  closeVersionPr: vi.fn(async (input: { number: number }) => {
    const pr = mockState.currentWorld().git.pullRequest;
    if (pr && pr.number === input.number) pr.closed = true;
    mockState.recordSideEffect({
      kind: "github.pr.close",
      target: String(input.number),
    });
  }),
}));

vi.mock("../../../src/utils/package-manager.js", () => ({
  getPackageManager: vi.fn(async () => "bun"),
}));

vi.mock("../../../src/utils/snapshot.js", () => ({
  generateSnapshotVersion: vi.fn(() => {
    const scenario = releaseBehaviorScenarios.find(
      (item) => item.id === "snapshot-restores-original-versions",
    );
    return scenario?.versionPlan.changes[0]?.to ?? "0.0.0-snapshot";
  }),
}));

vi.mock("../../../src/git.js", () => ({
  Git: class MockGit {
    async reset(...args: string[]) {
      mockState.recordSideEffect({
        kind: "git.reset",
        target: args.join(" ") || "index",
      });
      if (args.join(" ") === "HEAD^ --hard") {
        mockState.currentWorld().git.commits.pop();
      }
    }

    async stage(target: string) {
      mockState.recordSideEffect({ kind: "git.stage", target });
    }

    async checkTagExist(tag: string) {
      return mockState.currentWorld().git.localTags.has(tag);
    }

    async deleteTag(tag: string) {
      mockState.currentWorld().git.localTags.delete(tag);
      mockState.recordSideEffect({ kind: "git.tag.delete", target: tag });
    }

    async commit(message: string) {
      const id = `commit-${mockState.currentWorld().git.commits.length + 1}`;
      mockState.currentWorld().git.commits.push(id);
      mockState.recordSideEffect({
        kind: "git.commit",
        target: message.split("\n")[0] ?? "commit",
      });
      return id;
    }

    async createTag(tag: string) {
      mockState.currentWorld().git.localTags.add(tag);
      mockState.recordSideEffect({ kind: "git.tag", target: tag });
    }

    async push(args: string) {
      const success = mockState.currentWorld().pushSucceeds;
      if (success) {
        mockState.currentWorld().git.pushed = true;
        for (const tag of mockState.currentWorld().git.localTags) {
          mockState.currentWorld().git.remoteTags.add(tag);
        }
      }
      mockState.recordSideEffect({
        kind: "git.push",
        target: "origin",
        detail: success ? { args } : { args, result: false },
      });
      return success;
    }

    async pushDelete(_remote: string, tag: string) {
      mockState.currentWorld().git.remoteTags.delete(tag);
      mockState.recordSideEffect({ kind: "git.remoteTag.delete", target: tag });
    }

    async forcePush(remote: string, ref: string) {
      mockState.recordSideEffect({
        kind: "git.forcePush",
        target: `${remote} ${ref}`,
      });
    }

    async createBranch(branch: string) {
      mockState.currentWorld().git.branches.add(branch);
      mockState.recordSideEffect({
        kind: "git.branch.create",
        target: branch,
      });
    }

    async pushNewBranch(remote: string, branch: string) {
      mockState.currentWorld().git.branches.add(`${remote}/${branch}`);
      mockState.currentWorld().git.pushed = true;
      for (const tag of mockState.currentWorld().git.localTags) {
        mockState.currentWorld().git.remoteTags.add(tag);
      }
      mockState.recordSideEffect({
        kind: "git.branch.push",
        target: `${remote}/${branch}`,
        detail: { args: "--follow-tags" },
      });
    }

    async switch(branch: string) {
      mockState.recordSideEffect({ kind: "git.switch", target: branch });
    }

    async branch() {
      return "main";
    }

    async dryFetch() {
      return "";
    }

    async fetch() {}

    async revisionDiffsCount() {
      return 0;
    }

    async pull() {}

    async revParse(ref: string) {
      return `sha-${ref}`;
    }

    async latestTag() {
      return undefined;
    }

    async version() {
      return "git version 2.45.0";
    }

    async latestCommit() {
      return "sha-HEAD";
    }

    async previousTag() {
      return "v0.0.0";
    }

    async commits() {
      return [];
    }

    async status() {
      return "";
    }

    async stash() {}

    async popStash() {}

    async repository() {
      return "https://github.com/acme/repo.git";
    }
  },
}));

function createLedger(): SemanticLedger {
  return {
    events: [],
    decisions: [],
    facts: [],
    sideEffects: [],
    forbiddenSideEffects: [],
    compensations: [],
    prompts: [],
    releaseContexts: [],
    releaseRequests: [],
    changesetState: { consumed: [], changelogs: [] },
    finalState: {},
  };
}

function ecosystemOf(pkg: ReleaseScenarioPackage): "js" | "rust" {
  return (
    (pkg as ReleaseScenarioPackage & { ecosystem?: "js" | "rust" }).ecosystem ??
    "js"
  );
}

function packageKeyOf(pkg: ReleaseScenarioPackage): string {
  return `${pkg.path}::${ecosystemOf(pkg)}`;
}

function createWorld(
  root: string,
  scenario: ReleaseBehaviorScenario,
): ContractWorld {
  const failAt = scenario.failureInjection
    ? `${scenario.failureInjection.at}${
        scenario.failureInjection.target
          ? `:${scenario.failureInjection.target}`
          : ""
      }`
    : undefined;

  return {
    root,
    isCI: !!scenario.options.ci,
    failAt,
    sigintAfter:
      typeof scenario.options.sigintAfter === "string"
        ? scenario.options.sigintAfter
        : undefined,
    pushSucceeds: scenario.options.pushSucceeds !== false,
    githubToken: scenario.options.githubToken !== false,
    promptResponses: Array.isArray(scenario.options.promptResponses)
      ? [...scenario.options.promptResponses]
      : [],
    releaseAssets: scenario.options.releaseAssets
      ? [
          {
            name: "pubm-contract-darwin-arm64.tar.gz",
            filePath: path.join(root, "pubm-contract-darwin-arm64.tar.gz"),
            sha256: "asset-sha256",
          },
        ]
      : [],
    initialVersions: new Map(
      scenario.packages.flatMap((pkg) => {
        if (ecosystemOf(pkg) === "rust") {
          return [
            [
              mockState.toPosix(path.join(pkg.path, "Cargo.toml")),
              pkg.currentVersion,
            ],
          ];
        }
        const entries: [string, string][] = [
          [
            mockState.toPosix(path.join(pkg.path, "package.json")),
            pkg.currentVersion,
          ],
        ];
        if (pkg.registries.includes("jsr")) {
          entries.push([
            mockState.toPosix(path.join(pkg.path, "jsr.json")),
            pkg.currentVersion,
          ]);
        }
        return entries;
      }),
    ),
    ledger: createLedger(),
    git: {
      commits: ["initial"],
      localTags: new Set(
        Array.isArray(scenario.options.existingTags)
          ? (scenario.options.existingTags as string[])
          : [],
      ),
      remoteTags: new Set(),
      branches: new Set(),
      pushed: false,
      releases: new Map(),
    },
    registry: {
      published: new Map(),
      unpublished: [],
    },
  };
}

function writePackageFixture(root: string, pkg: ReleaseScenarioPackage): void {
  const packageDir = path.join(root, pkg.path);
  mkdirSync(packageDir, { recursive: true });

  if (ecosystemOf(pkg) === "rust") {
    writeFileSync(
      path.join(packageDir, "Cargo.toml"),
      `[package]\nname = "${pkg.name}"\nversion = "${pkg.currentVersion}"\nedition = "2021"\n`,
      "utf-8",
    );
    return;
  }

  writeFileSync(
    path.join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: pkg.name,
        version: pkg.currentVersion,
        scripts: { test: "test", build: "build" },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  if (pkg.registries.includes("jsr")) {
    writeFileSync(
      path.join(packageDir, "jsr.json"),
      `${JSON.stringify({ name: pkg.name, version: pkg.currentVersion }, null, 2)}\n`,
      "utf-8",
    );
  }
}

function readFixtureVersion(root: string, pkg: ReleaseScenarioPackage): string {
  if (ecosystemOf(pkg) === "rust") {
    return (
      readFileSync(path.join(root, pkg.path, "Cargo.toml"), "utf-8").match(
        /version = "([^"]+)"/,
      )?.[1] ?? ""
    );
  }
  const manifest = JSON.parse(
    readFileSync(path.join(root, pkg.path, "package.json"), "utf-8"),
  );
  return manifest.version;
}

function buildVersionPlan(scenario: ReleaseBehaviorScenario) {
  const packageVersions = new Map(
    scenario.packages.map((pkg) => {
      const change = scenario.versionPlan.changes.find(
        (item) => item.packageName === pkg.name,
      );
      return [packageKeyOf(pkg), change?.to ?? pkg.currentVersion];
    }),
  );

  if (scenario.packages.length === 1) {
    const pkg = scenario.packages[0];
    const version =
      packageVersions.get(packageKeyOf(pkg)) ?? pkg.currentVersion;
    return { mode: "single", version, packageKey: packageKeyOf(pkg) };
  }

  if (scenario.options.versioning === "fixed") {
    const version = [...packageVersions.values()][0] ?? "0.0.0";
    return { mode: "fixed", version, packages: packageVersions };
  }

  return { mode: "independent", packages: packageVersions };
}

function createRollbackTracker(ledger: SemanticLedger): RollbackTracker<any> {
  const rollback = new RollbackTracker<any>();
  const add = rollback.add.bind(rollback);
  const labelMatchesRegistryTarget = (label: string, target: string) => {
    if (label.includes(target)) return true;

    const payloadMatch = label.match(/\{.+\}$/);
    if (!payloadMatch) return false;
    try {
      const payload = JSON.parse(payloadMatch[0]) as {
        name?: string;
        version?: string;
      };
      return (
        typeof payload.name === "string" &&
        typeof payload.version === "string" &&
        target.endsWith(`${payload.name}@${payload.version}`)
      );
    } catch {
      return false;
    }
  };

  rollback.add = (action) => {
    const label = mockState.toPosix(action.label);
    ledger.compensations.push({ label, confirm: !!action.confirm });
    ledger.events.push({
      name: "compensation.registered",
      target: label,
      detail: { confirm: !!action.confirm },
    });
    add({
      ...action,
      fn: async (ctx: any) => {
        const skipConfirmTarget = mockState.state.sigintSkipConfirmTarget;
        if (action.confirm && skipConfirmTarget) {
          return;
        }

        await action.fn(ctx);
        if (label.startsWith("Restore ")) {
          const relativePath = label.replace(/^Restore /, "");
          const version = mockState
            .currentWorld()
            .initialVersions.get(relativePath);
          ledger.sideEffects.push({
            kind: "manifest.restore",
            target: relativePath,
            detail: { version },
          });
        }
      },
    });

    const sigintAfter = mockState.currentWorld().sigintAfter;
    if (sigintAfter?.startsWith("registry.publish:")) {
      const target = sigintAfter.replace(/^registry\.publish:/, "");
      if (labelMatchesRegistryTarget(label, target)) {
        mockState.currentWorld().sigintAfter = undefined;
        mockState.state.sigintSkipConfirmTarget = target;
        ledger.events.push({
          name: "process.exit",
          detail: { code: 130 },
        });
        throw new Error(`Injected SIGINT after ${target}`);
      }
    }
  };
  return rollback;
}

interface ReleaseExecutionAdapter {
  name: string;
  execute: (
    ctx: ReturnType<typeof createContext>,
    scenario: ReleaseBehaviorScenario,
    world: ContractWorld,
  ) => Promise<void>;
}

async function executeWithProcessExitCapture(
  world: ContractWorld,
  execute: () => Promise<void>,
): Promise<void> {
  const exit = vi.spyOn(process, "exit").mockImplementation(((code) => {
    world.ledger.events.push({
      name: "process.exit",
      detail: { code },
    });
    throw new Error("process.exit");
  }) as never);
  try {
    await expect(execute()).rejects.toThrow("process.exit");
  } finally {
    exit.mockRestore();
  }
}

async function executeReleaseRunner(
  scenario: ReleaseBehaviorScenario,
  world: ContractWorld,
  execute: () => Promise<void>,
): Promise<void> {
  if (scenario.failureInjection || scenario.options.sigintAfter) {
    await executeWithProcessExitCapture(world, execute);
    return;
  }

  try {
    await execute();
  } catch (error) {
    const lastError = world.ledger.events.find(
      (event) => event.name === "plugin.onError",
    );
    throw new Error(
      `Unexpected runner failure: ${error instanceof Error ? error.message : String(error)}; ${JSON.stringify(lastError)}; sideEffects=${JSON.stringify(
        sideEffectKeys(world),
      )}`,
    );
  }
}

async function executeCurrentRunner(
  ctx: ReturnType<typeof createContext>,
  scenario: ReleaseBehaviorScenario,
  world: ContractWorld,
): Promise<void> {
  if (scenario.mode === "snapshot") {
    const { runSnapshotPipeline } = await import(
      "../../../src/tasks/snapshot-runner.js"
    );
    await runSnapshotPipeline(ctx, {
      tag: String(scenario.options.tag ?? "snapshot"),
      dryRun: !!scenario.options.dryRun,
      skipTests: true,
      skipBuild: true,
    });
    return;
  }

  const entry = new URL(
    "../../../src/workflow/runner-entry.ts",
    import.meta.url,
  ).href;
  world.ledger.events.push({
    name: "workflowRunner.enter",
    target: scenario.id,
    detail: { entry },
  });
  const imported = await import(entry);
  const execute = imported.run ?? imported.default;
  if (typeof execute !== "function") {
    throw new Error("Workflow runner entry must export run or default.");
  }
  await executeReleaseRunner(scenario, world, () => execute(ctx));
  world.ledger.events.push({
    name: "workflowRunner.exit",
    target: scenario.id,
  });
}

const currentRunnerAdapter: ReleaseExecutionAdapter = {
  name: "workflow-runner",
  execute: executeCurrentRunner,
};

async function runScenario(
  scenario: ReleaseBehaviorScenario,
  adapter: ReleaseExecutionAdapter = currentRunnerAdapter,
): Promise<ContractWorld> {
  const root = path.join(
    tmpdir(),
    `pubm-release-contract-${scenario.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  for (const pkg of scenario.packages) writePackageFixture(root, pkg);

  const world = createWorld(root, scenario);
  mockState.state.world = world;
  mockState.state.isCI = world.isCI;
  mockState.state.sigintSkipConfirmTarget = undefined;

  const config = {
    versioning:
      (scenario.options.versioning as "fixed" | "independent") ?? "independent",
    branch: "main",
    changelog: true,
    changelogFormat: "default",
    commit: false,
    access: "public",
    createPr: !!scenario.options.createPr,
    fixed: [],
    linked: [],
    updateInternalDependencies: "patch",
    ignore: [],
    snapshotTemplate: "{tag}-{timestamp}",
    tag: scenario.options.tag ?? "latest",
    contents: ".",
    saveToken: true,
    releaseDraft: true,
    releaseNotes: true,
    rollback: { strategy: "individual", dangerouslyAllowUnpublish: true },
    lockfileSync: "optional",
    packages: scenario.packages.map((pkg) => ({
      path: pkg.path,
      name: pkg.name,
      version: pkg.currentVersion,
      dependencies: [],
      registries: [...pkg.registries],
      ecosystem: ecosystemOf(pkg),
    })),
    ecosystems: {},
    validate: { cleanInstall: true, entryPoints: true, extraneousFiles: true },
    plugins: [],
    compress: undefined,
    releaseAssets: scenario.options.releaseAssets
      ? [{ files: ["dist/*"] }]
      : undefined,
    excludeRelease: [],
    locale: "en",
    versionSources: "all",
    conventionalCommits: { types: {} },
    registryQualifiedTags: false,
  } as const;

  const options = {
    testScript: "test",
    buildScript: "build",
    mode: scenario.options.ci ? "ci" : "local",
    prepare: undefined,
    publish: scenario.options.publishOnly ? true : undefined,
    dryRun: !!scenario.options.dryRun,
    branch: "main",
    tag: scenario.options.tag ?? "latest",
    saveToken: true,
    skipTests: true,
    skipBuild: true,
    skipPublish: false,
    skipReleaseDraft: scenario.options.dryRun || scenario.options.publishOnly,
    skipDryRun: false,
  };

  if (world.githubToken) {
    process.env.GITHUB_TOKEN = "gh-token";
  } else {
    delete process.env.GITHUB_TOKEN;
  }
  const registryEnvKeys = [
    "NODE_AUTH_TOKEN",
    "JSR_TOKEN",
    "CARGO_REGISTRY_TOKEN",
    "REGISTRY_INTERNAL_TEST_NPM_TOKEN",
  ];
  const originalRegistryEnv = new Map(
    registryEnvKeys.map((key) => [key, process.env[key]]),
  );
  for (const key of registryEnvKeys) {
    process.env[key] = "registry-token";
  }
  process.env.NODE_AUTH_TOKEN = "node-token";
  process.env.JSR_TOKEN = "jsr-token";
  process.env.CARGO_REGISTRY_TOKEN = "cargo-token";
  process.env.REGISTRY_INTERNAL_TEST_NPM_TOKEN = "private-token";

  const ctx = createContext(config as any, options as any, root);
  ctx.runtime.versionPlan = buildVersionPlan(scenario) as any;
  ctx.runtime.tag = scenario.options.tag ?? "latest";
  ctx.runtime.rollback = createRollbackTracker(world.ledger);
  ctx.runtime.pluginRunner = {
    runHook: vi.fn(async (hookName: string) => {
      world.ledger.events.push({ name: `plugin.${hookName}` });
    }),
    runErrorHook: vi.fn(async (_ctx: unknown, error: Error) => {
      world.ledger.events.push({
        name: "plugin.onError",
        detail: { message: error.message },
      });
    }),
    runAfterReleaseHook: vi.fn(async (_ctx: unknown, result: any) => {
      const releaseContext = {
        displayLabel: result?.displayLabel,
        version: result?.version,
        tag: result?.tag,
        releaseUrl: result?.releaseUrl,
        releaseId: result?.releaseId,
        assets: result?.assets,
      };
      world.ledger.releaseContexts.push(releaseContext);
      world.ledger.events.push({
        name: "plugin.afterRelease",
        detail: releaseContext as Record<string, unknown>,
      });
    }),
    collectAssetHooks: vi.fn(() => ({})),
    collectChecks: vi.fn(() => []),
    collectCredentials: vi.fn(() => []),
  } as any;

  const originalIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: !!scenario.options.stdinIsTTY,
  });

  try {
    await adapter.execute(ctx, scenario, world);
  } finally {
    for (const [key, value] of originalRegistryEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  }

  world.ledger.finalState = {
    versions: Object.fromEntries(
      scenario.packages.map((pkg) => [pkg.name, readFixtureVersion(root, pkg)]),
    ),
    published: [...world.registry.published.keys()],
    unpublished: world.registry.unpublished,
    localTags: [...world.git.localTags],
    remoteTags: [...world.git.remoteTags],
    commits: [...world.git.commits],
    branches: [...world.git.branches],
    pullRequest: world.git.pullRequest,
    releases: [...world.git.releases.entries()].map(([id, release]) => ({
      id,
      ...release,
    })),
    pushed: world.git.pushed,
  };

  return world;
}

function scenario(id: string): ReleaseBehaviorScenario {
  const found = releaseBehaviorScenarios.find((item) => item.id === id);
  if (!found) throw new Error(`Missing release behavior scenario: ${id}`);
  return found;
}

function sideEffectKeys(world: ContractWorld): string[] {
  return world.ledger.sideEffects.map(
    (effect) => `${effect.kind}:${effect.target}`,
  );
}

function contractSideEffects(world: ContractWorld): SemanticSideEffect[] {
  return world.ledger.sideEffects.filter((effect) => {
    if (effect.kind === "git.stage") return false;
    if (effect.kind === "git.reset" && effect.target === "index") return false;
    return true;
  });
}

function sideEffectLabel(effect: SemanticSideEffect): string {
  return `${effect.kind}:${effect.target}${
    effect.detail ? ` ${JSON.stringify(effect.detail)}` : ""
  }`;
}

function sideEffectMatches(
  actual: SemanticSideEffect,
  expected: SemanticSideEffect,
): boolean {
  if (actual.kind !== expected.kind || actual.target !== expected.target) {
    return false;
  }
  if (!expected.detail) return true;
  if (!actual.detail) return false;

  return Object.entries(expected.detail).every(
    ([key, value]) =>
      JSON.stringify(actual.detail?.[key]) === JSON.stringify(value),
  );
}

function expectSideEffects(
  world: ContractWorld,
  expected: readonly SemanticSideEffect[],
): void {
  const actual = contractSideEffects(world);
  expect(
    actual,
    `Expected ${expected.length} contract side effects, observed ${actual.length}: ${JSON.stringify(
      actual.map(sideEffectLabel),
    )}`,
  ).toHaveLength(expected.length);

  expected.forEach((expectedEffect, index) => {
    expect(
      sideEffectMatches(actual[index], expectedEffect),
      `Side effect mismatch at index ${index}. Expected ${sideEffectLabel(
        expectedEffect,
      )}; observed ${sideEffectLabel(actual[index])}; full ledger ${JSON.stringify(
        actual.map(sideEffectLabel),
      )}`,
    ).toBe(true);
  });
}

function expectForbiddenSideEffects(
  world: ContractWorld,
  forbidden: readonly SemanticSideEffect[],
): void {
  for (const item of forbidden) {
    expect(
      world.ledger.sideEffects.some((effect) =>
        sideEffectMatches(effect, item),
      ),
      `Forbidden side effect was observed: ${sideEffectLabel(item)}`,
    ).toBe(false);
  }
}

function expectFinalVersions(
  world: ContractWorld,
  expected: Record<string, string>,
): void {
  expect(world.ledger.finalState.versions).toMatchObject(expected);
}

function expectFinalState(
  world: ContractWorld,
  expected: Record<string, unknown> | undefined,
): void {
  if (!expected) return;
  expect(world.ledger.finalState).toMatchObject(expected);
}

function normalizeRegistryRollbackLabel(
  world: ContractWorld,
  label: string,
): string {
  const npmMatch = label.match(/^task\.npm\.rollbackBurned (\{.+\})$/);
  const cratesMatch = label.match(/^task\.crates\.rollbackBurned (\{.+\})$/);
  const match = npmMatch ?? cratesMatch;
  if (!match) return label;

  try {
    const payload = JSON.parse(match[1]) as {
      name?: string;
      version?: string;
    };
    if (!payload.name || !payload.version) return label;

    const suffix = `${payload.name}@${payload.version}`;
    const targets = [
      ...world.registry.published.keys(),
      ...world.registry.unpublished,
    ];
    const target = targets.find((item) => {
      if (!item.endsWith(suffix)) return false;
      if (cratesMatch) return item.startsWith("crates:");
      return !item.startsWith("crates:") && !item.startsWith("jsr:");
    });
    if (!target) return label;

    return `${cratesMatch ? "yank" : "unpublish"} ${target}`;
  } catch {
    return label;
  }
}

function compensationLabels(world: ContractWorld): string[] {
  return world.ledger.compensations.map((item) =>
    normalizeRegistryRollbackLabel(world, item.label),
  );
}

function expectCompensationLabels(
  world: ContractWorld,
  expected: readonly string[],
  mode: "contains" | "exact" = "contains",
): void {
  const actual = compensationLabels(world);
  if (mode === "exact") {
    expect(actual).toEqual([...expected]);
  } else {
    expect(actual).toEqual(expect.arrayContaining([...expected]));
  }
}

describe("release behavior contract against the current runner", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockState.state.runnerSigintHandler = undefined;
    vi.spyOn(process, "on").mockImplementation(((
      event: string | symbol,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === "SIGINT" && !mockState.state.runnerSigintHandler) {
        mockState.state.runnerSigintHandler =
          listener as () => void | Promise<void>;
      }
      return process;
    }) as typeof process.on);
    vi.spyOn(process, "removeListener").mockImplementation(
      (() => process) as typeof process.removeListener,
    );
    vi.spyOn(Date, "now").mockReturnValue(1770000000000);
  });

  afterEach(() => {
    if (mockState.state.world?.root) {
      rmSync(mockState.state.world.root, { recursive: true, force: true });
    }
    mockState.state.world = undefined;
    mockState.state.isCI = false;
    mockState.state.runnerSigintHandler = undefined;
    mockState.state.sigintSkipConfirmTarget = undefined;
    delete process.env.GITHUB_TOKEN;
    delete process.env.NODE_AUTH_TOKEN;
    delete process.env.JSR_TOKEN;
    delete process.env.CARGO_REGISTRY_TOKEN;
    delete process.env.REGISTRY_INTERNAL_TEST_NPM_TOKEN;
  });

  it("characterizes local direct publish decisions, side effects, and compensations", async () => {
    const testScenario = scenario("local-direct-single-npm-jsr");
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
    expectCompensationLabels(world, testScenario.expected.compensationLabels);
  });

  it("keeps dry-run isolated from real publish, git push, and GitHub release effects", async () => {
    const testScenario = scenario("local-dry-run-no-side-effects");
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
  });

  it("uses pinned manifest versions in CI publish without rewriting versions", async () => {
    const testScenario = scenario("ci-publish-manifest-version");
    const world = await runScenario(testScenario);

    expect(world.ledger.events).toContainEqual({ name: "preflight.ciPublish" });
    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
  });

  it("rolls back successful publish work when a later publish target fails", async () => {
    const testScenario = scenario("partial-publish-failure-rollback");
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expect(world.registry.published.size).toBe(0);
    expect(world.git.commits).toEqual(["initial"]);
    expect(world.git.localTags.has("v4.1.0")).toBe(false);
    expect(world.git.pushed).toBe(false);
    expectCompensationLabels(
      world,
      testScenario.expected.compensationLabels,
      "exact",
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
  });

  it("restores snapshot versions after publishing with the snapshot tag", async () => {
    const testScenario = scenario("snapshot-restores-original-versions");
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
  });

  it("characterizes fixed monorepo release versions, tags, publishes, and release draft", async () => {
    const testScenario = scenario("local-fixed-monorepo-npm-jsr");
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
    expectCompensationLabels(world, testScenario.expected.compensationLabels);
  });

  it("characterizes independent monorepo release per-package tags and GitHub releases", async () => {
    const testScenario = scenario("local-independent-monorepo-tags");
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
    expectCompensationLabels(world, testScenario.expected.compensationLabels);
  });

  it.each([
    "local-direct-single-npm-jsr",
    "local-dry-run-no-side-effects",
    "ci-publish-manifest-version",
    "local-fixed-monorepo-npm-jsr",
    "local-independent-monorepo-tags",
    "local-independent-crates-order-and-yank",
    "local-private-registry-boundary",
    "local-push-fallback-version-pr",
    "local-release-browser-draft-fallback",
    "local-github-release-assets-payload",
  ])("characterizes external boundary scenario %s", async (scenarioId) => {
    const testScenario = scenario(scenarioId);
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
    expectCompensationLabels(world, testScenario.expected.compensationLabels);
    if (scenarioId === "local-github-release-assets-payload") {
      expect(world.ledger.releaseContexts).toEqual([
        expect.objectContaining({
          displayLabel: "@pubm/contract-assets",
          version: "8.1.0",
          releaseId: "release-v8.1.0",
        }),
      ]);
    }
  });

  it.each([
    "github-release-create-fails-after-push",
    "github-release-asset-upload-fails-after-release-created",
    "crates-publish-then-github-release-fails",
    "push-fallback-version-pr-fails",
    "tag-overwrite-prompt-cancel-rolls-back",
    "sigint-after-publish-runs-rollback",
  ])("guards side-effect failure and interruption scenario %s", async (scenarioId) => {
    const testScenario = scenario(scenarioId);
    const world = await runScenario(testScenario);

    expectSideEffects(world, testScenario.expected.sideEffects);
    expectForbiddenSideEffects(
      world,
      testScenario.expected.forbiddenSideEffects,
    );
    expectFinalVersions(world, testScenario.expected.finalVersions);
    expectFinalState(world, testScenario.expected.finalState);
    expectCompensationLabels(
      world,
      testScenario.expected.compensationLabels,
      "exact",
    );

    if (scenarioId.includes("prompt")) {
      expect(world.ledger.prompts).toEqual([
        expect.objectContaining({ cancelled: true }),
      ]);
    }
    if (scenarioId.includes("sigint")) {
      expect(world.ledger.events).toContainEqual({
        name: "process.exit",
        detail: { code: 130 },
      });
    }
  });
});
