import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import type {
  ReleaseOperation,
  ReleaseOperationContext,
} from "../../../../src/workflow/release-operation.js";

interface RegistryDescriptorMock {
  concurrentPublish?: boolean;
  key?: string;
  label: string;
  orderPackages?: (keys: string[]) => Promise<string[]> | string[];
}

const publishState = vi.hoisted(() => ({
  backups: new Map<string, string>(),
  descriptors: new Map<string, RegistryDescriptorMock>(),
  groups: [
    {
      ecosystem: "js",
      registries: [{ registry: "npm", packageKeys: ["packages/a::js"] }],
    },
  ],
  restoreCalls: [] as unknown[],
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../../src/monorepo/resolve-workspace.js", () => ({
  restoreManifests: vi.fn((backups: unknown) => {
    publishState.restoreCalls.push(backups);
  }),
}));

vi.mock("../../../../src/tasks/grouping.js", () => ({
  collectEcosystemRegistryGroups: vi.fn(() => publishState.groups),
  ecosystemLabel: vi.fn((ecosystem: string) => ecosystem),
}));

vi.mock("../../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) => publishState.descriptors.get(key)),
  },
}));

vi.mock("../../../../src/workflow/registry-operations.js", () => ({
  createRegistryPublishOperation: vi.fn((registry: string, key: string) => ({
    title: `${registry}:${key}`,
    run: vi.fn(),
  })),
}));

vi.mock("../../../../src/workflow/release-utils/manifest-handling.js", () => ({
  resolveWorkspaceProtocols: vi.fn(async (ctx: PubmContext) => {
    ctx.runtime.workspaceBackups = publishState.backups;
  }),
}));

vi.mock("../../../../src/workflow/release-utils/output-formatting.js", () => ({
  countPublishTargets: vi.fn(() => 1),
  formatRegistryGroupSummary: vi.fn(() => "registry summary"),
}));

import { createRegistryPublishOperation } from "../../../../src/workflow/registry-operations.js";
import {
  collectPublishOperations,
  createPublishOperations,
} from "../../../../src/workflow/release-phases/publish.js";

function createContext(): PubmContext {
  return {
    config: { packages: [] },
    runtime: {
      pluginRunner: {
        runHook: vi.fn(),
      },
    },
  } as unknown as PubmContext;
}

function createParentTask(
  runOperations = vi.fn(async () => undefined),
): ReleaseOperationContext {
  return {
    title: "",
    output: "",
    prompt: () => ({ run: vi.fn() }),
    runOperations,
    runTasks: vi.fn(),
    skip: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  publishState.backups = new Map([["package.json", "{}"]]);
  publishState.descriptors.clear();
  publishState.groups = [
    {
      ecosystem: "js",
      registries: [{ registry: "npm", packageKeys: ["packages/a::js"] }],
    },
  ];
  publishState.restoreCalls = [];
});

describe("createPublishOperations", () => {
  it("restores workspace manifests when publish operations fail", async () => {
    const ctx = createContext();
    const parent = createParentTask(
      vi.fn(async () => {
        throw new Error("publish failed");
      }),
    );
    const operations = createPublishOperations(true, false, false);

    await expect(operations[0]?.run?.(ctx, parent)).rejects.toThrow(
      "publish failed",
    );

    expect(publishState.restoreCalls).toEqual([publishState.backups]);
    expect(ctx.runtime.workspaceBackups).toBeUndefined();
    expect((operations[1]?.skip as (ctx: PubmContext) => boolean)(ctx)).toBe(
      true,
    );
    expect(operations[2]?.run).toBeDefined();
  });

  it("restores workspace manifests after successful publish operations", async () => {
    const ctx = createContext();
    const parent = createParentTask();
    const operations = createPublishOperations(true, false, false);

    await operations[0]?.run?.(ctx, parent);
    await operations[2]?.run?.(ctx, parent);

    expect(publishState.restoreCalls).toEqual([publishState.backups]);
    expect(ctx.runtime.workspaceBackups).toBeUndefined();
    expect((operations[1]?.skip as (ctx: PubmContext) => boolean)(ctx)).toBe(
      true,
    );
    expect(ctx.runtime.pluginRunner.runHook).toHaveBeenCalledWith(
      "afterPublish",
      ctx,
    );
  });
});

describe("collectPublishOperations", () => {
  it("filters registry publish operations to scoped package keys before ordering", async () => {
    publishState.groups = [
      {
        ecosystem: "js",
        registries: [
          {
            registry: "npm",
            packageKeys: ["packages/b::js", "packages/a::js"],
          },
        ],
      },
    ];
    publishState.descriptors.set("npm", {
      concurrentPublish: true,
      label: "npm",
      orderPackages: vi.fn(async (keys: string[]) => [...keys].sort()),
    });
    const operations = await collectPublishOperations({ config: {} } as never, {
      packageKeys: new Set(["packages/a::js"]),
    });
    const parent = {
      runOperations: vi.fn(
        async (nested: ReleaseOperation | readonly ReleaseOperation[]) => {
          const nestedOperations = Array.isArray(nested) ? nested : [nested];
          for (const operation of nestedOperations) {
            await operation.run?.({} as never, parent as never);
          }
        },
      ),
    };

    await operations[0]?.run?.({} as never, parent as never);

    expect(
      publishState.descriptors.get("npm")?.orderPackages,
    ).toHaveBeenCalledWith(["packages/a::js"]);
    expect(createRegistryPublishOperation).toHaveBeenCalledTimes(1);
    expect(createRegistryPublishOperation).toHaveBeenCalledWith(
      "npm",
      "packages/a::js",
    );
  });
});
