import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dryRunState = vi.hoisted(() => ({
  groups: [] as Array<{
    ecosystem: string;
    registries: Array<{ registry: string; packageKeys: string[] }>;
  }>,
  descriptors: new Map<string, any>(),
  restoreCalls: [] as unknown[],
  syncLockfileCalls: [] as unknown[],
  writeVersionsCalls: [] as unknown[],
}));

vi.mock("../../../../src/ecosystem/catalog.js", () => ({
  ecosystemCatalog: {
    get: vi.fn(() => ({
      ecosystemClass: class MockEcosystem {
        constructor(readonly packagePath: string) {}

        async syncLockfile(value: unknown): Promise<void> {
          dryRunState.syncLockfileCalls.push([this.packagePath, value]);
        }
      },
    })),
  },
}));

vi.mock("../../../../src/tasks/grouping.js", () => ({
  collectEcosystemRegistryGroups: vi.fn(() => dryRunState.groups),
  countRegistryTargets: vi.fn((groups) =>
    groups.reduce(
      (count: number, group: (typeof dryRunState.groups)[number]) => {
        return count + group.registries.length;
      },
      0,
    ),
  ),
  ecosystemLabel: vi.fn((ecosystem: string) => ecosystem),
  registryLabel: vi.fn((registry: string) => registry),
}));

vi.mock("../../../../src/monorepo/resolve-workspace.js", () => ({
  restoreManifests: vi.fn((backups: unknown) => {
    dryRunState.restoreCalls.push(backups);
  }),
}));

vi.mock("../../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) => dryRunState.descriptors.get(key)),
  },
}));

vi.mock("../../../../src/workflow/registry-operations.js", () => ({
  createRegistryDryRunOperation: vi.fn((registry: string, key: string) => ({
    title: `${registry}:${key}`,
    run: vi.fn(),
  })),
}));

vi.mock("../../../../src/workflow/release-utils/manifest-handling.js", () => ({
  applyVersionsForDryRun: vi.fn(async () => undefined),
  resolveWorkspaceProtocols: vi.fn(async () => undefined),
}));

vi.mock("../../../../src/workflow/release-utils/write-versions.js", () => ({
  writeVersions: vi.fn(async (...args: unknown[]) => {
    dryRunState.writeVersionsCalls.push(args);
  }),
}));

import { createRegistryDryRunOperation } from "../../../../src/workflow/registry-operations.js";
import { createDryRunOperations } from "../../../../src/workflow/release-phases/dry-run.js";
import { applyVersionsForDryRun } from "../../../../src/workflow/release-utils/manifest-handling.js";

describe("createDryRunOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dryRunState.groups = [];
    dryRunState.descriptors.clear();
    dryRunState.restoreCalls = [];
    dryRunState.syncLockfileCalls = [];
    dryRunState.writeVersionsCalls = [];
  });

  it("returns enabled operations when skipDryRun is false and prepare phase validation is enabled", () => {
    const tasks = createDryRunOperations(false, true, false);
    expect(tasks[0].enabled).toBe(true);
    expect(tasks[1].enabled).toBe(true);
    expect(tasks[2].enabled).toBe(false);
  });

  it("returns disabled operations when skipDryRun is true", () => {
    const tasks = createDryRunOperations(false, true, true);
    expect(tasks[0].enabled).toBe(false);
    expect(tasks[1].enabled).toBe(false);
    expect(tasks[2].enabled).toBe(false);
  });

  it("returns disabled operations when neither dryRun nor prepare phase validation is enabled", () => {
    const tasks = createDryRunOperations(false, false, false);
    expect(tasks[0].enabled).toBe(false);
  });

  it("returns enabled operations when dryRun is true and skipDryRun is false", () => {
    const tasks = createDryRunOperations(true, false, false);
    expect(tasks[0].enabled).toBe(true);
  });

  it("skipDryRun overrides dryRun flag", () => {
    const tasks = createDryRunOperations(true, false, true);
    expect(tasks[0].enabled).toBe(false);
  });

  it("builds nested dry-run operations with descriptor ordering and sequential registries", async () => {
    dryRunState.groups = [
      {
        ecosystem: "js",
        registries: [
          { registry: "npm", packageKeys: ["b::js", "a::js"] },
          { registry: "custom", packageKeys: ["c::js"] },
        ],
      },
    ];
    dryRunState.descriptors.set("npm", {
      concurrentPublish: false,
      label: "npm",
      orderPackages: vi.fn(async (keys: string[]) => [...keys].sort()),
    });
    const parentRuns: unknown[] = [];
    const parent = {
      title: "",
      output: "",
      runOperations: vi.fn(async (operations, options) => {
        parentRuns.push([operations, options]);
        for (const operation of operations) {
          await operation.run({}, parent);
        }
      }),
    };

    await createDryRunOperations(true, true, false)[0]?.run?.(
      {
        config: { packages: [] },
        runtime: {},
      } as never,
      parent as never,
    );

    expect(parent.title).toContain("2");
    expect(parentRuns.at(0)?.[1]).toEqual({ concurrent: true });
    expect(parentRuns).toHaveLength(4);
  });

  it("restores workspace protocols and syncs package lockfiles", async () => {
    const backups = new Map([["package.json", "{}"]]);
    const ctx = {
      config: {
        lockfileSync: "always",
        packages: [
          { ecosystem: "js", path: "packages/a" },
          { ecosystem: "js", path: "packages/b" },
        ],
      },
      cwd: "/repo",
      runtime: { workspaceBackups: backups },
    };

    await createDryRunOperations(true, true, false)[1]?.run?.(
      ctx as never,
      {} as never,
    );

    expect(dryRunState.restoreCalls).toEqual([backups]);
    expect(ctx.runtime.workspaceBackups).toBeUndefined();
    expect(dryRunState.syncLockfileCalls).toEqual([
      [path.resolve("/repo", "packages/a"), "always"],
      [path.resolve("/repo", "packages/b"), "always"],
    ]);
  });

  it("throws when restore operations are missing their required backups", async () => {
    await expect(
      createDryRunOperations(true, true, false)[1]?.run?.(
        { runtime: {} } as never,
        {} as never,
      ),
    ).rejects.toThrow("Workspace backups are required");

    await expect(
      createDryRunOperations(true, true, false)[2]?.run?.(
        { runtime: {} } as never,
        {} as never,
      ),
    ).rejects.toThrow("Dry-run version backup is required");
  });

  it("restores dry-run versions when a version backup exists", async () => {
    const backupVersions = new Map([["packages/a::js", "1.0.0"]]);
    const ctx = { runtime: { dryRunVersionBackup: backupVersions } };

    await createDryRunOperations(true, true, false)[2]?.run?.(
      ctx as never,
      {} as never,
    );

    expect(dryRunState.writeVersionsCalls[0]?.[1]).toBe(backupVersions);
    expect(ctx.runtime.dryRunVersionBackup).toBeUndefined();
  });

  it("does not enable success-path version restore for prepare-phase validation", () => {
    const restoreVersions = createDryRunOperations(false, true, false)[2];

    expect(restoreVersions?.enabled).toBe(false);
  });

  it("keeps dry-run restore rollback registered when validation fails", async () => {
    dryRunState.groups = [
      {
        ecosystem: "js",
        registries: [{ registry: "npm", packageKeys: ["packages/a::js"] }],
      },
    ];
    dryRunState.descriptors.set("npm", {
      concurrentPublish: true,
      label: "npm",
    });

    const rollbackActions: Array<{ label: string; fn: () => Promise<void> }> =
      [];
    const ctx = {
      config: { packages: [] },
      runtime: {
        rollback: {
          add: (item: (typeof rollbackActions)[number]) => {
            rollbackActions.push(item);
          },
        },
      },
    };
    const parent = {
      title: "",
      output: "",
      runOperations: vi.fn(async (operations) => {
        for (const operation of operations) {
          await operation.run?.(ctx as never, parent as never);
        }
      }),
    };

    vi.mocked(applyVersionsForDryRun).mockImplementationOnce(async (runCtx) => {
      runCtx.runtime.rollback.add({
        label: "Restore dry-run version changes",
        fn: async () => undefined,
      });
    });
    vi.mocked(createRegistryDryRunOperation).mockReturnValueOnce({
      title: "npm:packages/a::js",
      run: vi.fn(async () => {
        throw new Error("validation failed");
      }),
    });

    await expect(
      createDryRunOperations(false, true, false)[0]?.run?.(
        ctx as never,
        parent as never,
      ),
    ).rejects.toThrow("validation failed");

    expect(rollbackActions.map((action) => action.label)).toEqual([
      "Restore dry-run version changes",
    ]);
  });
});
