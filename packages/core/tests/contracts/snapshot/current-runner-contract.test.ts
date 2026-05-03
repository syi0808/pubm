import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import type { PubmContext } from "../../../src/context.js";

interface SemanticEffect {
  kind: string;
  target: string;
  detail?: Record<string, unknown>;
}

const mockState = vi.hoisted(() => {
  const state = {
    effects: [] as SemanticEffect[],
    failPublish: false,
    isCI: false,
  };

  const toPosix = (value: string) => value.replace(/\\/g, "/");

  return {
    state,
    reset: () => {
      state.effects = [];
      state.failPublish = false;
      state.isCI = false;
    },
    record: (effect: SemanticEffect) => {
      state.effects.push({ ...effect, target: toPosix(effect.target) });
    },
    toPosix,
  };
});

vi.mock("std-env", () => ({
  get isCI() {
    return mockState.state.isCI;
  },
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) => {
    if (key === "error.snapshot.noMatchingPackages") {
      return "No packages matched the provided --filter patterns.";
    }
    return values ? `${key} ${JSON.stringify(values)}` : key;
  },
}));

vi.mock("../../../src/workflow/release-phases/preflight-checks.js", () => ({
  createPrerequisitesCheckOperation: vi.fn(() => ({
    title: "Prerequisites",
    run: vi.fn(async () => {
      mockState.record({ kind: "preflight", target: "prerequisites" });
    }),
  })),
  createRequiredConditionsCheckOperation: vi.fn(() => ({
    title: "Required conditions",
    run: vi.fn(async () => {
      mockState.record({ kind: "preflight", target: "conditions" });
    }),
  })),
}));

vi.mock("../../../src/workflow/release-phases/preflight.js", () => ({
  runCiPublishPluginCreds: vi.fn(async () => {
    mockState.record({ kind: "preflight", target: "ci-plugin-creds" });
  }),
}));

vi.mock("../../../src/utils/listr.js", () => {
  return {
    createCiListrOptions: vi.fn(() => ({ renderer: "ci" })),
    createListr: vi.fn(() => {
      throw new Error("Snapshot contract must not use createListr");
    }),
  };
});

vi.mock("../../../src/workflow/release-utils/write-versions.js", () => {
  const packageKey = (pkg: ResolvedPackageConfig) =>
    `${pkg.path}::${pkg.ecosystem}`;

  const manifestPath = (ctx: PubmContext, pkg: ResolvedPackageConfig) =>
    path.join(ctx.cwd, pkg.path, "package.json");

  return {
    writeVersions: vi.fn(
      async (ctx: PubmContext, versions: Map<string, string>) => {
        const touched: string[] = [];
        for (const pkg of ctx.config.packages) {
          const version = versions.get(packageKey(pkg));
          if (!version) continue;

          const filePath = manifestPath(ctx, pkg);
          const manifest = JSON.parse(readFileSync(filePath, "utf-8"));
          manifest.version = version;
          writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
          touched.push(filePath);
          mockState.record({
            kind:
              version === pkg.version ? "manifest.restore" : "manifest.write",
            target: path.relative(ctx.cwd, filePath),
            detail: { version },
          });
        }
        return touched;
      },
    ),
  };
});

vi.mock("../../../src/workflow/release-phases/publish.js", () => {
  const manifestPath = (ctx: PubmContext, pkg: ResolvedPackageConfig) =>
    path.join(ctx.cwd, pkg.path, "package.json");

  const manifestVersion = (ctx: PubmContext, pkg: ResolvedPackageConfig) => {
    const manifest = JSON.parse(readFileSync(manifestPath(ctx, pkg), "utf-8"));
    return manifest.version;
  };

  return {
    collectPublishOperations: vi.fn(async (ctx: PubmContext) => [
      {
        title: "Publish snapshot packages",
        run: async () => {
          for (const pkg of ctx.config.packages) {
            const version = manifestVersion(ctx, pkg);
            const target = `npm:${pkg.name}@${version}`;
            mockState.record({
              kind: "registry.publish",
              target,
              detail: { tag: ctx.runtime.tag, version },
            });
            if (mockState.state.failPublish) {
              throw new Error("Injected snapshot publish failure");
            }
          }
        },
      },
    ]),
  };
});

vi.mock("../../../src/workflow/release-utils/manifest-handling.js", () => ({
  resolveWorkspaceProtocols: vi.fn(async (ctx: PubmContext) => {
    const versionsByName = new Map(
      ctx.config.packages.map((pkg) => {
        const manifest = JSON.parse(
          readFileSync(path.join(ctx.cwd, pkg.path, "package.json"), "utf-8"),
        );
        return [pkg.name, manifest.version] as const;
      }),
    );
    const backups = new Map<string, string>();

    for (const pkg of ctx.config.packages) {
      const filePath = path.join(ctx.cwd, pkg.path, "package.json");
      const original = readFileSync(filePath, "utf-8");
      const manifest = JSON.parse(original);
      let changed = false;

      for (const section of ["dependencies", "devDependencies"] as const) {
        const dependencies = manifest[section];
        if (!dependencies) continue;
        for (const [name, specifier] of Object.entries(dependencies)) {
          if (
            typeof specifier === "string" &&
            specifier.startsWith("workspace:")
          ) {
            dependencies[name] = versionsByName.get(name) ?? specifier;
            changed = true;
          }
        }
      }

      if (changed) {
        backups.set(filePath, original);
        writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
        mockState.record({
          kind: "workspace.resolve",
          target: path.relative(ctx.cwd, filePath),
        });
      }
    }

    if (backups.size > 0) ctx.runtime.workspaceBackups = backups;
  }),
}));

vi.mock("../../../src/monorepo/resolve-workspace.js", () => ({
  restoreManifests: vi.fn((backups: Map<string, string>) => {
    for (const [filePath, content] of backups) {
      writeFileSync(filePath, content, "utf-8");
      mockState.record({
        kind: "workspace.restore",
        target: filePath,
      });
    }
  }),
}));

vi.mock("../../../src/git.js", () => ({
  Git: class MockGit {
    async latestCommit() {
      return "sha-HEAD";
    }

    async createTag(tag: string, commit?: string) {
      mockState.record({
        kind: "git.tag",
        target: tag,
        detail: { commit },
      });
    }

    async push(args: string) {
      mockState.record({
        kind: "git.push",
        target: "origin",
        detail: { args },
      });
      return true;
    }
  },
}));

vi.mock("../../../src/utils/ui.js", () => ({
  ui: {
    chalk: {
      bold: (s: string) => s,
      blueBright: (s: string) => s,
    },
  },
}));

vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) =>
      key === "npm"
        ? {
            label: "npm",
            resolveDisplayName: vi.fn(async (config: { packages: any[] }) =>
              config.packages.map((pkg) => pkg.name),
            ),
          }
        : undefined,
    ),
  },
}));

vi.mock("../../../src/utils/registries.js", () => ({
  collectRegistries: vi.fn(() => ["npm"]),
}));

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

vi.mock("../../../src/utils/package-manager.js", () => ({
  getPackageManager: vi.fn(async () => "bun"),
}));

import { createContext } from "../../../src/context.js";
import {
  applySnapshotFilter,
  buildSnapshotVersionPlan,
  runSnapshotPipeline,
} from "../../../src/tasks/snapshot-runner.js";
import type { ResolvedOptions } from "../../../src/types/options.js";
import {
  snapshotFilterPackages,
  snapshotFilterScenarios,
  snapshotPipelinePackages,
  snapshotPlanScenarios,
} from "./scenarios.js";

const tempRoots: string[] = [];
let consoleLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-27T05:30:00Z"));
  mockState.reset();
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  consoleLog.mockRestore();
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

function createProjectRoot(id: string): string {
  const root = path.join(
    tmpdir(),
    `pubm-snapshot-contract-${id}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  tempRoots.push(root);
  return root;
}

function writeManifest(
  root: string,
  pkg: ResolvedPackageConfig,
  extra: Record<string, unknown> = {},
): string {
  const packageDir = path.join(root, pkg.path);
  mkdirSync(packageDir, { recursive: true });
  const content = `${JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      ...extra,
    },
    null,
    2,
  )}\n`;
  writeFileSync(path.join(packageDir, "package.json"), content, "utf-8");
  return content;
}

function readManifest(root: string, pkg: ResolvedPackageConfig): unknown {
  return JSON.parse(
    readFileSync(path.join(root, pkg.path, "package.json"), "utf-8"),
  );
}

function readManifestText(root: string, pkg: ResolvedPackageConfig): string {
  return readFileSync(path.join(root, pkg.path, "package.json"), "utf-8");
}

function createSnapshotContext(
  root: string,
  packages: readonly ResolvedPackageConfig[],
  versioning: "fixed" | "independent" = "fixed",
): PubmContext {
  const options = {
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "snapshot",
    saveToken: true,
  } satisfies ResolvedOptions;

  return createContext(
    {
      versioning,
      branch: "main",
      changelog: true,
      commit: false,
      access: "public",
      fixed: [],
      linked: [],
      updateInternalDependencies: "patch",
      ignore: [],
      snapshotTemplate: "{tag}-{timestamp}",
      tag: "latest",
      contents: ".",
      saveToken: true,
      releaseDraft: true,
      releaseNotes: true,
      release: {
        versioning: {
          mode: versioning,
          fixed: [],
          linked: [],
          updateInternalDependencies: "patch",
        },
        changesets: { directory: ".pubm/changesets" },
        commits: { format: "conventional", types: {} },
        changelog: true,
        pullRequest: {
          branchTemplate: "pubm/release/{scopeSlug}",
          titleTemplate: "chore(release): {scope} {version}",
          label: "pubm:release-pr",
          bumpLabels: {
            patch: "release:patch",
            minor: "release:minor",
            major: "release:major",
            prerelease: "release:prerelease",
          },
          grouping: versioning,
          fixed: [],
          linked: [],
          unversionedChanges: "warn",
        },
      },
      rollback: { strategy: "individual", dangerouslyAllowUnpublish: true },
      lockfileSync: "optional",
      packages: [...packages],
      ecosystems: {},
      validate: {
        cleanInstall: true,
        entryPoints: true,
        extraneousFiles: true,
      },
      plugins: [],
      compress: undefined,
      releaseAssets: undefined,
      excludeRelease: [],
      locale: "en",
      registryQualifiedTags: false,
    },
    options,
    root,
  );
}

function effectKeys(): string[] {
  return mockState.state.effects.map(
    (effect) => `${effect.kind}:${effect.target}`,
  );
}

describe("Snapshot Expansion contract", () => {
  describe("version plans", () => {
    for (const scenario of snapshotPlanScenarios) {
      it(`${scenario.id}: ${scenario.description}`, () => {
        const plan = buildSnapshotVersionPlan(
          [...scenario.packages],
          scenario.versioning,
          scenario.tag,
          scenario.template,
        );

        expect(plan.mode).toBe(scenario.expected.mode);
        if (plan.mode === "fixed") {
          expect(plan.version).toBe(scenario.expected.version);
          expect(Object.fromEntries(plan.packages)).toEqual(
            scenario.expected.packages,
          );
        } else if (plan.mode === "independent") {
          expect(Object.fromEntries(plan.packages)).toEqual(
            scenario.expected.packages,
          );
        } else {
          throw new Error(`Unexpected plan mode: ${plan.mode}`);
        }
      });
    }
  });

  describe("filter selection", () => {
    for (const scenario of snapshotFilterScenarios) {
      it(`${scenario.id}: ${scenario.description}`, () => {
        if (scenario.expectedError) {
          expect(() =>
            applySnapshotFilter(
              [...snapshotFilterPackages],
              scenario.filters ? [...scenario.filters] : undefined,
            ),
          ).toThrow(scenario.expectedError);
          return;
        }

        const selected = applySnapshotFilter(
          [...snapshotFilterPackages],
          scenario.filters ? [...scenario.filters] : undefined,
        );
        expect(selected.map((pkg) => pkg.path)).toEqual(scenario.expectedPaths);
      });
    }
  });

  it("dry-run snapshot execution restores manifests and forbids tag and push side effects", async () => {
    const root = createProjectRoot("dry-run");
    const [pkg] = snapshotPipelinePackages;
    writeManifest(root, pkg);
    const ctx = createSnapshotContext(root, [pkg], "fixed");

    await runSnapshotPipeline(ctx, {
      tag: "snapshot",
      dryRun: true,
      skipTests: true,
      skipBuild: true,
    });

    expect(readManifest(root, pkg)).toMatchObject({ version: "1.0.0" });
    expect(effectKeys()).not.toContain(
      "git.tag:v1.0.0-snapshot-20260427T053000",
    );
    expect(effectKeys()).not.toContain("git.push:origin");
  });

  it("publish failure restores manifest versions and workspace protocol dependencies", async () => {
    const root = createProjectRoot("publish-failure-restore");
    const [pkgA, pkgB] = snapshotPipelinePackages;
    const initialA = writeManifest(root, pkgA, {
      dependencies: { [pkgB.name]: "workspace:*" },
    });
    const initialB = writeManifest(root, pkgB);
    const ctx = createSnapshotContext(root, snapshotPipelinePackages, "fixed");
    mockState.state.failPublish = true;

    await expect(
      runSnapshotPipeline(ctx, {
        tag: "snapshot",
        skipTests: true,
        skipBuild: true,
      }),
    ).rejects.toThrow("Injected snapshot publish failure");

    expect(readManifestText(root, pkgA)).toBe(initialA);
    expect(readManifestText(root, pkgB)).toBe(initialB);
    expect(effectKeys()).toContain("workspace.resolve:packages/a/package.json");
    expect(effectKeys()).toContain("manifest.restore:packages/a/package.json");
    expect(effectKeys()).toContain("manifest.restore:packages/b/package.json");
    expect(effectKeys()).not.toContain("git.push:origin");
  });
});
