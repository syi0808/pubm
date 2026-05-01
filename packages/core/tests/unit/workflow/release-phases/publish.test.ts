import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import type { ReleaseOperationContext } from "../../../../src/workflow/release-operation.js";

const publishState = vi.hoisted(() => ({
  backups: new Map<string, string>(),
  groups: [
    {
      ecosystem: "js",
      registries: [{ registry: "npm", packageKeys: ["packages/a::js"] }],
    },
  ],
  restoreCalls: [] as unknown[],
}));

vi.mock("../../../../src/monorepo/resolve-workspace.js", () => ({
  restoreManifests: vi.fn((backups: unknown) => {
    publishState.restoreCalls.push(backups);
  }),
}));

vi.mock("../../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn(() => ({
      concurrentPublish: true,
      key: "npm",
      label: "npm",
    })),
  },
}));

vi.mock("../../../../src/tasks/grouping.js", () => ({
  collectEcosystemRegistryGroups: vi.fn(() => publishState.groups),
  ecosystemLabel: vi.fn((ecosystem: string) => ecosystem),
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

import { createPublishOperations } from "../../../../src/workflow/release-phases/publish.js";

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
    skip: vi.fn(),
  };
}

describe("createPublishOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishState.backups = new Map([["package.json", "{}"]]);
    publishState.restoreCalls = [];
  });

  it("restores workspace manifests when publish operations fail", async () => {
    const ctx = createContext();
    const parent = createParentTask(
      vi.fn(async () => {
        throw new Error("publish failed");
      }),
    );

    await expect(
      createPublishOperations(true, false, false)[0]?.run?.(ctx, parent),
    ).rejects.toThrow("publish failed");

    expect(publishState.restoreCalls).toEqual([publishState.backups]);
    expect(ctx.runtime.workspaceBackups).toBeUndefined();
  });

  it("restores workspace manifests after successful publish operations", async () => {
    const ctx = createContext();
    const parent = createParentTask();

    await createPublishOperations(true, false, false)[0]?.run?.(ctx, parent);

    expect(publishState.restoreCalls).toEqual([publishState.backups]);
    expect(ctx.runtime.workspaceBackups).toBeUndefined();
  });
});
