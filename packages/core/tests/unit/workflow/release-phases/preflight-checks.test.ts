import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const checkAvailability = vi.fn();
  const npmFactory = vi.fn(async () => ({ checkAvailability }));
  const cratesFactory = vi.fn(async () => ({ checkAvailability }));

  return {
    git: {
      branch: vi.fn(),
      switch: vi.fn(),
      dryFetch: vi.fn(),
      fetch: vi.fn(),
      revisionDiffsCount: vi.fn(),
      pull: vi.fn(),
      status: vi.fn(),
      latestTag: vi.fn(),
      commits: vi.fn(),
      version: vi.fn(),
    },
    registry: {
      checkAvailability,
      npmFactory,
      cratesFactory,
    },
    registryCatalogGet: vi.fn((key: string) => {
      if (key === "npm") {
        return {
          key: "npm",
          ecosystem: "js",
          label: "npm",
          factory: npmFactory,
        };
      }
      if (key === "crates") {
        return {
          key: "crates",
          ecosystem: "rust",
          label: "crates.io",
          factory: cratesFactory,
        };
      }
      return undefined;
    }),
    connector: {
      ping: vi.fn(),
    },
    validateEngineVersion: vi.fn(),
    detectWorkspace: vi.fn(() => []),
  };
});

vi.mock("../../../../src/git.js", () => ({
  Git: vi.fn(function () {
    return mocks.git;
  }),
}));

vi.mock("../../../../src/registry/index.js", () => ({
  getConnector: vi.fn(() => mocks.connector),
}));

vi.mock("../../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: mocks.registryCatalogGet,
  },
}));

vi.mock("../../../../src/utils/engine-version.js", () => ({
  validateEngineVersion: mocks.validateEngineVersion,
}));

vi.mock("../../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: mocks.detectWorkspace,
}));

vi.mock("../../../../src/ecosystem/catalog.js", () => {
  class MockEcosystem {
    validateScript() {
      return Promise.resolve(null);
    }
  }

  const descriptors: Record<string, unknown> = {
    js: {
      key: "js",
      label: "JavaScript",
      ecosystemClass: MockEcosystem,
    },
    rust: {
      key: "rust",
      label: "Rust",
      ecosystemClass: MockEcosystem,
    },
  };

  return {
    ecosystemCatalog: {
      get: vi.fn((key: string) => descriptors[key]),
      all: vi.fn(() => Object.values(descriptors)),
    },
  };
});

vi.mock("../../../../src/plugin/wrap-task-context.js", () => ({
  wrapTaskContext: vi.fn((task: unknown) => task),
}));

import type { PubmContext } from "../../../../src/context.js";
import type {
  ReleaseOperation,
  ReleaseOperationContext,
} from "../../../../src/workflow/release-operation.js";
import { makeTestContext } from "../../../helpers/make-context.js";

function pkg(
  path: string,
  registries: string[] = ["npm"],
  ecosystem: "js" | "rust" = "js",
  name = path === "." ? "root" : path.replaceAll("/", "-"),
) {
  return {
    path,
    name,
    version: "1.0.0",
    dependencies: [],
    registries,
    ecosystem,
  };
}

function createCtx(
  overrides: {
    config?: Partial<PubmContext["config"]>;
    options?: Partial<PubmContext["options"]>;
    runtime?: Partial<PubmContext["runtime"]>;
  } = {},
): PubmContext {
  return makeTestContext({
    config: {
      packages: [pkg(".")],
      ...overrides.config,
    },
    options: {
      branch: "main",
      anyBranch: false,
      ...overrides.options,
    },
    runtime: {
      version: "1.0.0",
      promptEnabled: true,
      cleanWorkingTree: true,
      ...overrides.runtime,
    },
  });
}

function createTask(promptResponses: unknown[] = []) {
  let promptIndex = 0;
  return {
    title: "",
    output: "",
    prompt: vi.fn(() => ({
      run: vi.fn(async () => promptResponses[promptIndex++]),
    })),
    runOperations: vi.fn(),
    skip: vi.fn(),
  };
}

async function captureOperations(
  operation: ReleaseOperation,
  ctx: PubmContext,
) {
  let captured: readonly ReleaseOperation[] = [];
  const parent = createTask();
  parent.runOperations = vi.fn(
    async (operations: ReleaseOperation | readonly ReleaseOperation[]) => {
      captured = Array.isArray(operations) ? operations : [operations];
    },
  );

  await operation.run?.(ctx, parent as unknown as ReleaseOperationContext);

  return captured;
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.git.branch.mockResolvedValue("main");
  mocks.git.switch.mockResolvedValue(undefined);
  mocks.git.dryFetch.mockResolvedValue("");
  mocks.git.fetch.mockResolvedValue(undefined);
  mocks.git.revisionDiffsCount.mockResolvedValue(0);
  mocks.git.pull.mockResolvedValue(undefined);
  mocks.git.status.mockResolvedValue("");
  mocks.git.latestTag.mockResolvedValue("v0.9.0");
  mocks.git.commits.mockResolvedValue([{ id: "abc123" }]);
  mocks.git.version.mockResolvedValue("2.40.0");
  mocks.registry.npmFactory.mockResolvedValue({
    checkAvailability: mocks.registry.checkAvailability,
  });
  mocks.registry.cratesFactory.mockResolvedValue({
    checkAvailability: mocks.registry.checkAvailability,
  });
});

describe("createPrerequisitesCheckOperation", () => {
  it("throws without prompting when branch differs and prompts are disabled", async () => {
    const { createPrerequisitesCheckOperation } = await import(
      "../../../../src/workflow/release-phases/preflight-checks.js"
    );
    const ctx = createCtx({ runtime: { promptEnabled: false } });
    const operations = await captureOperations(
      createPrerequisitesCheckOperation(),
      ctx,
    );
    const task = createTask();
    mocks.git.branch.mockResolvedValue("develop");

    await expect(
      operations[0]?.run?.(ctx, task as unknown as ReleaseOperationContext),
    ).rejects.toThrow(/release target branch/);

    expect(task.prompt).not.toHaveBeenCalled();
    expect(mocks.git.switch).not.toHaveBeenCalled();
  });

  it("throws without prompting when remote fetch is outdated and prompts are disabled", async () => {
    const { createPrerequisitesCheckOperation } = await import(
      "../../../../src/workflow/release-phases/preflight-checks.js"
    );
    const ctx = createCtx({ runtime: { promptEnabled: false } });
    const operations = await captureOperations(
      createPrerequisitesCheckOperation(),
      ctx,
    );
    const task = createTask();
    mocks.git.dryFetch.mockResolvedValue("remote updates");

    await expect(
      operations[1]?.run?.(ctx, task as unknown as ReleaseOperationContext),
    ).rejects.toThrow(/git fetch/);

    expect(task.prompt).not.toHaveBeenCalled();
    expect(mocks.git.fetch).not.toHaveBeenCalled();
  });

  it("throws without prompting when working tree is dirty and prompts are disabled", async () => {
    const { createPrerequisitesCheckOperation } = await import(
      "../../../../src/workflow/release-phases/preflight-checks.js"
    );
    const ctx = createCtx({ runtime: { promptEnabled: false } });
    const operations = await captureOperations(
      createPrerequisitesCheckOperation(),
      ctx,
    );
    const task = createTask();
    mocks.git.status.mockResolvedValue("M package.json");

    await expect(
      operations[2]?.run?.(ctx, task as unknown as ReleaseOperationContext),
    ).rejects.toThrow(/working tree is not clean/);

    expect(task.prompt).not.toHaveBeenCalled();
    expect(ctx.runtime.cleanWorkingTree).toBe(true);
  });

  it("throws without prompting when no commits exist and prompts are disabled", async () => {
    const { createPrerequisitesCheckOperation } = await import(
      "../../../../src/workflow/release-phases/preflight-checks.js"
    );
    const ctx = createCtx({ runtime: { promptEnabled: false } });
    const operations = await captureOperations(
      createPrerequisitesCheckOperation(),
      ctx,
    );
    const task = createTask();
    mocks.git.latestTag.mockResolvedValue("v1.0.0");
    mocks.git.commits.mockResolvedValue([]);

    await expect(
      operations[3]?.run?.(ctx, task as unknown as ReleaseOperationContext),
    ).rejects.toThrow(/No commits exist/);

    expect(task.prompt).not.toHaveBeenCalled();
  });
});

describe("createRequiredConditionsCheckOperation", () => {
  it("uses registry descriptor factories for availability checks", async () => {
    const { createRequiredConditionsCheckOperation } = await import(
      "../../../../src/workflow/release-phases/preflight-checks.js"
    );
    const ctx = createCtx({
      config: {
        packages: [pkg("packages/core", ["npm"], "js", "@scope/core")],
      },
    });
    const operations = await captureOperations(
      createRequiredConditionsCheckOperation(),
      ctx,
    );
    const availabilityOperation = operations[3];
    const parentTask = createTask();
    let ecosystemOperations: readonly ReleaseOperation[] = [];
    parentTask.runOperations = vi.fn(
      async (operations: ReleaseOperation | readonly ReleaseOperation[]) => {
        ecosystemOperations = Array.isArray(operations)
          ? operations
          : [operations];
      },
    );

    await availabilityOperation?.run?.(
      ctx,
      parentTask as unknown as ReleaseOperationContext,
    );

    let registryOperations: readonly ReleaseOperation[] = [];
    const ecosystemTask = createTask();
    ecosystemTask.runOperations = vi.fn(
      async (operations: ReleaseOperation | readonly ReleaseOperation[]) => {
        registryOperations = Array.isArray(operations)
          ? operations
          : [operations];
      },
    );
    await ecosystemOperations[0]?.run?.(
      ctx,
      ecosystemTask as unknown as ReleaseOperationContext,
    );

    const checkTask = createTask();
    await registryOperations[0]?.run?.(
      ctx,
      checkTask as unknown as ReleaseOperationContext,
    );

    expect(mocks.registry.npmFactory).toHaveBeenCalledWith("packages/core");
    expect(mocks.registry.checkAvailability).toHaveBeenCalledWith(
      checkTask,
      ctx,
    );
  });

  it("enables registry-qualified tags when the tag collision prompt is accepted", async () => {
    const { createRequiredConditionsCheckOperation } = await import(
      "../../../../src/workflow/release-phases/preflight-checks.js"
    );
    const ctx = createCtx({
      config: {
        packages: [
          pkg("packages/js", ["npm"], "js", "shared-name"),
          pkg("crates/rust", ["crates"], "rust", "shared-name"),
        ],
      },
      runtime: { promptEnabled: true },
    });
    const operations = await captureOperations(
      createRequiredConditionsCheckOperation(),
      ctx,
    );
    const collisionTask = createTask([true]);

    await operations
      .at(-1)
      ?.run?.(ctx, collisionTask as unknown as ReleaseOperationContext);

    expect(collisionTask.prompt).toHaveBeenCalledOnce();
    expect(ctx.runtime.registryQualifiedTags).toBe(true);
  });
});
