import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import { runReleaseOperations } from "../../../../src/workflow/release-operation.js";
import {
  createPrerequisitesCheckOperation,
  createRequiredConditionsCheckOperation,
  detectTagNameCollisions,
} from "../../../../src/workflow/release-phases/preflight-checks.js";

const preflightState = vi.hoisted(() => ({
  promptResponses: [] as unknown[],
  git: {
    branch: "main",
    dryFetch: "",
    revisionDiffsCount: 0,
    status: "",
    latestTag: "v1.0.0",
    commits: ["commit"],
    version: "2.40.0",
    calls: [] as string[],
  },
  connectors: new Map<string, { ping: ReturnType<typeof vi.fn> }>(),
  registries: new Map<string, any>(),
  scriptErrors: new Map<string, string | undefined>(),
  workspaces: [] as Array<{ type: string }>,
  validatedScripts: [] as Array<{ cwd: string; script: string; kind: string }>,
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../../src/utils/prompt.js", () => ({
  prompt: vi.fn(async () => preflightState.promptResponses.shift()),
}));

vi.mock("../../../../src/utils/ui.js", () => ({
  ui: {
    labels: { WARNING: "WARNING" },
  },
}));

vi.mock("../../../../src/utils/engine-version.js", () => ({
  validateEngineVersion: vi.fn(),
}));

vi.mock("../../../../src/git.js", () => ({
  Git: class MockGit {
    async branch(): Promise<string> {
      return preflightState.git.branch;
    }

    async switch(branch: string): Promise<void> {
      preflightState.git.calls.push(`switch:${branch}`);
      preflightState.git.branch = branch;
    }

    async dryFetch(): Promise<string> {
      return preflightState.git.dryFetch;
    }

    async fetch(): Promise<void> {
      preflightState.git.calls.push("fetch");
    }

    async revisionDiffsCount(): Promise<number> {
      return preflightState.git.revisionDiffsCount;
    }

    async pull(): Promise<void> {
      preflightState.git.calls.push("pull");
    }

    async status(): Promise<string> {
      return preflightState.git.status;
    }

    async latestTag(): Promise<string | undefined> {
      return preflightState.git.latestTag;
    }

    async commits(): Promise<string[]> {
      return preflightState.git.commits;
    }

    async version(): Promise<string> {
      return preflightState.git.version;
    }
  },
}));

vi.mock("../../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(() => preflightState.workspaces),
}));

vi.mock("../../../../src/registry/index.js", () => ({
  getConnector: vi.fn((key: string) => {
    let connector = preflightState.connectors.get(key);
    if (!connector) {
      connector = { ping: vi.fn(async () => undefined) };
      preflightState.connectors.set(key, connector);
    }
    return connector;
  }),
}));

vi.mock("../../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) => preflightState.registries.get(key)),
  },
}));

vi.mock("../../../../src/ecosystem/catalog.js", () => ({
  ecosystemCatalog: {
    get: vi.fn((key: string) => ({
      key,
      label: key,
      ecosystemClass: class MockEcosystem {
        constructor(readonly packagePath: string) {}

        async validateScript(
          script: string,
          kind: string,
        ): Promise<string | undefined> {
          preflightState.validatedScripts.push({
            cwd: this.packagePath,
            script,
            kind,
          });
          return preflightState.scriptErrors.get(`${this.packagePath}:${kind}`);
        }
      },
    })),
  },
}));

function createContext(
  overrides: {
    options?: Partial<PubmContext["options"]>;
    config?: Record<string, unknown>;
    promptEnabled?: boolean;
    collectPrerequisiteChecks?: PubmContext["runtime"]["pluginRunner"]["collectChecks"];
    collectConditionChecks?: PubmContext["runtime"]["pluginRunner"]["collectChecks"];
  } = {},
): PubmContext {
  const baseChecks = vi.fn(() => []);
  return {
    cwd: "/repo",
    options: {
      anyBranch: false,
      branch: "main",
      skipBuild: false,
      skipTests: false,
      testScript: "test",
      buildScript: "build",
      ...overrides.options,
    },
    config: {
      versioning: "fixed",
      registryQualifiedTags: false,
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: ["npm"],
        },
      ],
      ecosystems: {},
      ...overrides.config,
    },
    runtime: {
      cleanWorkingTree: false,
      pluginRunner: {
        collectChecks: vi.fn((ctx: PubmContext, phase: string) => {
          if (phase === "prerequisites") {
            return overrides.collectPrerequisiteChecks?.(ctx, phase) ?? [];
          }
          if (phase === "conditions") {
            return overrides.collectConditionChecks?.(ctx, phase) ?? [];
          }
          return baseChecks(ctx, phase);
        }),
      } as unknown as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: overrides.promptEnabled ?? false,
      rollback: {
        add: vi.fn(),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
    },
  } as PubmContext;
}

function registerRegistry(key: string, ecosystem = "js") {
  const checkAvailability = vi.fn(async () => undefined);
  preflightState.registries.set(key, {
    key,
    ecosystem,
    label: key,
    factory: vi.fn(async () => ({ checkAvailability })),
  });
  return { checkAvailability, descriptor: preflightState.registries.get(key) };
}

function packageCwd(pkgPath: string): string {
  return path.resolve("/repo", pkgPath);
}

beforeEach(() => {
  preflightState.promptResponses = [];
  preflightState.git = {
    branch: "main",
    dryFetch: "",
    revisionDiffsCount: 0,
    status: "",
    latestTag: "v1.0.0",
    commits: ["commit"],
    version: "2.40.0",
    calls: [],
  };
  preflightState.connectors.clear();
  preflightState.registries.clear();
  preflightState.scriptErrors.clear();
  preflightState.workspaces = [];
  preflightState.validatedScripts = [];
  registerRegistry("npm");
});

describe("createPrerequisitesCheckOperation", () => {
  it("throws instead of prompting when the current branch is wrong in noninteractive mode", async () => {
    preflightState.git.branch = "feature";
    const ctx = createContext();

    await expect(
      runReleaseOperations(ctx, createPrerequisitesCheckOperation()),
    ).rejects.toThrow("error.prerequisites.wrongBranch");
    expect(preflightState.git.calls).toEqual([]);
  });

  it("switches branch, fetches, pulls, and accepts a dirty tree when prompted", async () => {
    preflightState.git.branch = "feature";
    preflightState.git.dryFetch = "outdated";
    preflightState.git.revisionDiffsCount = 1;
    preflightState.git.status = " M package.json";
    preflightState.promptResponses = [true, true, true, true];
    const ctx = createContext({ promptEnabled: true });

    await runReleaseOperations(ctx, createPrerequisitesCheckOperation());

    expect(preflightState.git.calls).toEqual(["switch:main", "fetch", "pull"]);
    expect(ctx.runtime.cleanWorkingTree).toBe(false);
  });

  it("fails when no commits exist since the latest tag and prompts are disabled", async () => {
    preflightState.git.commits = [];
    const ctx = createContext();

    await expect(
      runReleaseOperations(ctx, createPrerequisitesCheckOperation()),
    ).rejects.toThrow("error.prerequisites.noCommits");
  });

  it("runs plugin prerequisite checks through the wrapped operation context", async () => {
    const pluginTask = vi.fn(async () => undefined);
    const ctx = createContext({
      collectPrerequisiteChecks: vi.fn(() => [
        { title: "Plugin prerequisite", task: pluginTask },
      ]),
    });

    await runReleaseOperations(ctx, createPrerequisitesCheckOperation());

    expect(pluginTask).toHaveBeenCalledWith(ctx, expect.any(Object));
  });

  it.each([
    [
      "branch",
      () => (preflightState.git.branch = "feature"),
      "error.prerequisites.wrongBranch",
    ],
    [
      "fetch",
      () => (preflightState.git.dryFetch = "outdated"),
      "error.prerequisites.outdatedFetch",
    ],
    [
      "pull",
      () => (preflightState.git.revisionDiffsCount = 1),
      "error.prerequisites.outdatedPull",
    ],
    [
      "dirty tree",
      () => (preflightState.git.status = " M file"),
      "error.prerequisites.workingTreeDirty",
    ],
  ])("throws when the user rejects the %s prerequisite prompt", async (_name, setup, message) => {
    setup();
    preflightState.promptResponses = [false];
    const ctx = createContext({ promptEnabled: true });

    await expect(
      runReleaseOperations(ctx, createPrerequisitesCheckOperation()),
    ).rejects.toThrow(message);
  });

  it("allows no latest tag and accepted no-commit prompts", async () => {
    preflightState.git.latestTag = "";
    const ctx = createContext({ promptEnabled: true });

    await runReleaseOperations(ctx, createPrerequisitesCheckOperation());

    preflightState.git.latestTag = "v1.0.0";
    preflightState.git.commits = [];
    preflightState.promptResponses = [true];

    await runReleaseOperations(ctx, createPrerequisitesCheckOperation());
  });

  it("skips branch verification when anyBranch is enabled", async () => {
    preflightState.git.branch = "feature";
    const ctx = createContext({ options: { anyBranch: true } });

    await runReleaseOperations(ctx, createPrerequisitesCheckOperation());

    expect(preflightState.git.calls).toEqual([]);
  });
});

describe("createRequiredConditionsCheckOperation", () => {
  it("pings registries, validates scripts, checks git, and checks package availability", async () => {
    const { checkAvailability, descriptor } = registerRegistry("jsr");
    const ctx = createContext({
      config: {
        packages: [
          {
            ecosystem: "js",
            name: "pkg-a",
            path: "packages/a",
            registries: ["npm", "jsr"],
          },
        ],
      },
      collectConditionChecks: vi.fn(() => [
        { title: "Plugin condition", task: vi.fn(async () => undefined) },
      ]),
    });

    await runReleaseOperations(ctx, createRequiredConditionsCheckOperation());

    expect(preflightState.connectors.get("npm")?.ping).toHaveBeenCalled();
    expect(preflightState.connectors.get("jsr")?.ping).toHaveBeenCalled();
    expect(preflightState.validatedScripts).toEqual([
      { cwd: packageCwd("packages/a"), script: "test", kind: "test" },
      { cwd: packageCwd("packages/a"), script: "build", kind: "build" },
    ]);
    expect(descriptor.factory).toHaveBeenCalledWith("packages/a");
    expect(checkAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String) }),
      ctx,
    );
  });

  it("checks availability for each package when a registry group has multiple packages", async () => {
    const { descriptor } = registerRegistry("npm");
    const ctx = createContext({
      options: { skipBuild: true, skipTests: true },
      config: {
        packages: [
          {
            ecosystem: "js",
            name: "pkg-a",
            path: "packages/a",
            registries: ["npm"],
          },
          {
            ecosystem: "js",
            name: "pkg-b",
            path: "packages/b",
            registries: ["npm"],
          },
        ],
      },
    });

    await runReleaseOperations(ctx, createRequiredConditionsCheckOperation());

    expect(descriptor.factory).toHaveBeenCalledWith("packages/a");
    expect(descriptor.factory).toHaveBeenCalledWith("packages/b");
  });

  it("reports missing scripts from ecosystem validation", async () => {
    preflightState.scriptErrors.set(
      `${packageCwd("packages/a")}:test`,
      "missing test",
    );
    const ctx = createContext();

    await expect(
      runReleaseOperations(ctx, createRequiredConditionsCheckOperation()),
    ).rejects.toThrow("error.conditions.scriptsMissing");
  });

  it("lets an interactive user opt into registry-qualified tags for name collisions", async () => {
    preflightState.promptResponses = [true];
    registerRegistry("crates", "rust");
    const ctx = createContext({
      promptEnabled: true,
      options: { skipBuild: true, skipTests: true },
      config: {
        versioning: "independent",
        packages: [
          {
            ecosystem: "js",
            name: "shared",
            path: "packages/shared-js",
            registries: ["npm"],
          },
          {
            ecosystem: "rust",
            name: "shared",
            path: "crates/shared",
            registries: ["crates"],
          },
        ],
      },
    });

    await runReleaseOperations(ctx, createRequiredConditionsCheckOperation());

    expect(ctx.runtime.registryQualifiedTags).toBe(true);
  });

  it("throws on tag collisions when prompts are disabled", async () => {
    registerRegistry("crates", "rust");
    const ctx = createContext({
      options: { skipBuild: true, skipTests: true },
      config: {
        versioning: "independent",
        packages: [
          {
            ecosystem: "js",
            name: "shared",
            path: "packages/shared-js",
            registries: ["npm"],
          },
          {
            ecosystem: "rust",
            name: "shared",
            path: "crates/shared",
            registries: ["crates"],
          },
        ],
      },
    });

    await expect(
      runReleaseOperations(ctx, createRequiredConditionsCheckOperation()),
    ).rejects.toThrow("error.conditions.tagCollision");
  });

  it("skips script checks when both test and build checks are disabled", async () => {
    const ctx = createContext({
      options: { skipBuild: true, skipTests: true },
    });

    await runReleaseOperations(ctx, createRequiredConditionsCheckOperation());

    expect(preflightState.validatedScripts).toEqual([]);
  });

  it("validates workspace-level scripts once unless a package override is present", async () => {
    preflightState.workspaces = [{ type: "pnpm" }];
    const ctx = createContext({
      config: {
        packages: [
          {
            ecosystem: "js",
            name: "pkg-a",
            path: "packages/a",
            registries: ["npm"],
          },
          {
            ecosystem: "js",
            name: "pkg-b",
            path: "packages/b",
            registries: ["npm"],
          },
          {
            buildScript: "build:pkg",
            ecosystem: "js",
            name: "pkg-c",
            path: "packages/c",
            registries: ["npm"],
            testScript: "test:pkg",
          },
        ],
      },
    });

    await runReleaseOperations(ctx, createRequiredConditionsCheckOperation());

    expect(preflightState.validatedScripts).toEqual([
      { cwd: "/repo", script: "test", kind: "test" },
      { cwd: "/repo", script: "build", kind: "build" },
      { cwd: packageCwd("packages/c"), script: "test:pkg", kind: "test" },
      { cwd: packageCwd("packages/c"), script: "build:pkg", kind: "build" },
    ]);
  });

  it("allows missing registry descriptors and non-colliding independent tags", async () => {
    preflightState.registries.delete("missing");
    const ctx = createContext({
      options: { skipBuild: true, skipTests: true },
      config: {
        versioning: "independent",
        packages: [
          {
            ecosystem: "js",
            name: "pkg-a",
            path: "packages/a",
            registries: ["missing"],
          },
          {
            ecosystem: "rust",
            name: "pkg-b",
            path: "crates/b",
            registries: ["missing"],
          },
        ],
      },
    });

    await runReleaseOperations(ctx, createRequiredConditionsCheckOperation());

    expect(ctx.runtime.registryQualifiedTags).toBeUndefined();
  });
});

describe("detectTagNameCollisions", () => {
  it("returns package names used by multiple ecosystems", () => {
    expect(
      detectTagNameCollisions([
        { name: "same", ecosystem: "js" },
        { name: "same", ecosystem: "rust" },
        { name: "unique", ecosystem: "js" },
      ] as never),
    ).toEqual(["same"]);
  });
});
