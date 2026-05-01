import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../src/context.js";
import {
  createRegistryDryRunOperation,
  createRegistryPublishOperation,
} from "../../../src/workflow/registry-operations.js";
import type { ReleaseOperationContext } from "../../../src/workflow/release-operation.js";

const registryState = vi.hoisted(() => ({
  descriptors: new Map<string, any>(),
  openUrls: [] as string[],
  secureSets: [] as Array<[string, string]>,
  rustDeps: new Map<string, string[]>(),
  rustNames: new Map<string, string>(),
  jsr: { token: undefined as string | undefined },
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("@pubm/runner", () => ({
  color: {
    cyan: (value: string) => value,
  },
}));

vi.mock("../../../src/registry/catalog.js", () => ({
  registryCatalog: {
    get: vi.fn((key: string) => registryState.descriptors.get(key)),
  },
}));

vi.mock("../../../src/registry/jsr.js", () => ({
  JsrClient: registryState.jsr,
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: class MockRustEcosystem {
    constructor(readonly packagePath: string) {}

    async packageName(): Promise<string> {
      return (
        registryState.rustNames.get(this.packagePath) ??
        this.packagePath.split("/").at(-1) ??
        this.packagePath
      );
    }

    async dependencies(): Promise<string[]> {
      return registryState.rustDeps.get(this.packagePath) ?? [];
    }
  },
}));

vi.mock("../../../src/utils/open-url.js", () => ({
  openUrl: vi.fn(async (url: string) => {
    registryState.openUrls.push(url);
  }),
}));

vi.mock("../../../src/utils/secure-store.js", () => ({
  SecureStore: class MockSecureStore {
    set(key: string, value: string): void {
      registryState.secureSets.push([key, value]);
    }
  },
}));

vi.mock("../../../src/utils/ui.js", () => ({
  ui: {
    chalk: {
      bold: (value: string) => value,
      cyan: (value: string) => value,
      yellow: (value: string) => value,
    },
  },
}));

function createContext(
  overrides: Partial<PubmContext["runtime"]> = {},
): PubmContext {
  const rollbackItems: Array<{
    label: string;
    fn: () => Promise<void>;
    confirm?: boolean;
  }> = [];

  return {
    config: {
      rollback: { dangerouslyAllowUnpublish: false },
      packages: [
        {
          ecosystem: "js",
          name: "pkg",
          path: "packages/pkg",
          registries: ["npm"],
          version: "1.2.3",
        },
        {
          ecosystem: "rust",
          name: "crate-root",
          path: "crates/root",
          registries: ["crates"],
          version: "2.0.0",
        },
        {
          ecosystem: "rust",
          name: "crate-dep",
          path: "crates/dep",
          registries: ["crates"],
          version: "2.0.0",
        },
      ],
    },
    cwd: "/repo",
    options: {},
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {} as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: false,
      rollback: {
        add: (item: (typeof rollbackItems)[number]) => rollbackItems.push(item),
        items: rollbackItems,
      },
      tag: "latest",
      versionPlan: {
        mode: "independent",
        packages: new Map([
          ["packages/pkg::js", "1.2.3"],
          ["crates/root::rust", "2.0.0"],
          ["crates/dep::rust", "2.0.0"],
        ]),
      },
      ...overrides,
    },
  } as unknown as PubmContext;
}

function createOperation(
  promptResponses: unknown[] = [],
): ReleaseOperationContext & { prompts: unknown[] } {
  const prompts: unknown[] = [];

  return {
    title: "",
    output: "",
    prompts,
    prompt: () => ({
      run: vi.fn(async () => {
        const response = promptResponses.shift() ?? "";
        prompts.push(response);
        return response;
      }),
    }),
    runOperations: vi.fn(),
    skip: vi.fn(),
  };
}

function createRegistry(overrides: Record<string, unknown> = {}) {
  return {
    packageName: "pkg",
    packagePath: "packages/pkg",
    supportsUnpublish: true,
    isVersionPublished: vi.fn(async () => false),
    isPublished: vi.fn(async () => false),
    publish: vi.fn(async () => true),
    publishProvenance: vi.fn(async () => true),
    dryRunPublish: vi.fn(async () => undefined),
    unpublish: vi.fn(async () => undefined),
    ...overrides,
  };
}

function registerDescriptor(
  key: string,
  registry: ReturnType<typeof createRegistry>,
  overrides: Record<string, unknown> = {},
) {
  registryState.descriptors.set(key, {
    key,
    label: key,
    tokenConfig: {
      dbKey: `${key}-token`,
      envVar:
        key === "npm"
          ? "NODE_AUTH_TOKEN"
          : key === "jsr"
            ? "JSR_TOKEN"
            : `${key.toUpperCase()}_TOKEN`,
      promptLabel: `${key} token`,
    },
    unpublishLabel: key === "crates" ? "Yank" : "Unpublish",
    factory: vi.fn(async () => registry),
    ...overrides,
  });
}

function rollbackItems(ctx: PubmContext): Array<{
  label: string;
  fn: () => Promise<void>;
  confirm?: boolean;
}> {
  return (
    ctx.runtime.rollback as unknown as {
      items: Array<{
        label: string;
        fn: () => Promise<void>;
        confirm?: boolean;
      }>;
    }
  ).items;
}

async function runPublish(
  registryKey: string,
  packageKey: string,
  ctx = createContext(),
  operation = createOperation(),
) {
  const releaseOperation = createRegistryPublishOperation(
    registryKey,
    packageKey,
  );
  await releaseOperation.run?.(ctx, operation);
  return operation;
}

async function runDryRun(
  registryKey: string,
  packageKey: string,
  ctx = createContext(),
  operation = createOperation(),
  siblingKeys?: string[],
) {
  const releaseOperation = createRegistryDryRunOperation(
    registryKey,
    packageKey,
    siblingKeys,
  );
  await releaseOperation.run?.(ctx, operation);
  return operation;
}

describe("registry release operations", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    registryState.descriptors.clear();
    registryState.openUrls.length = 0;
    registryState.secureSets.length = 0;
    registryState.rustDeps.clear();
    registryState.rustNames.clear();
    registryState.jsr.token = undefined;
    process.env.NODE_AUTH_TOKEN = "npm-token";
    process.env.JSR_TOKEN = "jsr-token";
  });

  afterEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("publishes npm-like registries in CI with provenance and rollback", async () => {
    const registry = createRegistry();
    registerDescriptor("npm", registry);
    const ctx = createContext();

    await runPublish("npm", "packages/pkg::js", ctx);

    expect(registry.publishProvenance).toHaveBeenCalledWith("latest");
    expect(rollbackItems(ctx)).toHaveLength(1);
    expect(rollbackItems(ctx)[0]?.label).toContain("task.npm.rollbackSkipped");
  });

  it("prompts for npm OTP in local mode and reuses the accepted code", async () => {
    const publish = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const registry = createRegistry({ publish });
    registerDescriptor("npm", registry);
    const ctx = createContext({ promptEnabled: true });
    const operation = createOperation(["123456"]);

    await runPublish("npm", "packages/pkg::js", ctx, operation);

    expect(publish).toHaveBeenNthCalledWith(1, undefined, "latest");
    expect(publish).toHaveBeenNthCalledWith(2, "123456", "latest");
    expect(ctx.runtime.npmOtp).toBe("123456");
    expect(operation.title).toContain("task.npm.otpPassed");
    expect(rollbackItems(ctx)[0]?.confirm).toBe(true);
  });

  it("publishes npm immediately when a cached OTP is accepted", async () => {
    const publish = vi.fn(async () => true);
    const registry = createRegistry({ publish });
    registerDescriptor("npm", registry);
    const ctx = createContext({ npmOtp: "123456", promptEnabled: true });
    const operation = createOperation(["unused"]);

    await runPublish("npm", "packages/pkg::js", ctx, operation);

    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith("123456", "latest");
    expect(operation.prompts).toEqual([]);
  });

  it("shares an in-flight npm OTP prompt across concurrent publishes", async () => {
    let resolveOtp: (otp: string) => void = () => {};
    const otpPrompt = new Promise<string>((resolve) => {
      resolveOtp = resolve;
    });
    const publish = vi.fn(async (otp?: string) => otp === "654321");
    const registry = createRegistry({ publish });
    registerDescriptor("npm", registry);
    const ctx = createContext({ promptEnabled: true });
    const firstOperation = {
      ...createOperation(),
      prompt: () => ({
        run: vi.fn(async () => otpPrompt),
      }),
    };
    const secondOperation = createOperation(["should-not-prompt"]);

    const firstPublish = runPublish(
      "npm",
      "packages/pkg::js",
      ctx,
      firstOperation,
    );
    for (
      let attempts = 0;
      attempts < 5 && !ctx.runtime.npmOtpPromise;
      attempts++
    ) {
      await Promise.resolve();
    }
    expect(ctx.runtime.npmOtpPromise).toBeDefined();

    const secondPublish = runPublish(
      "npm",
      "packages/pkg::js",
      ctx,
      secondOperation,
    );
    for (
      let attempts = 0;
      attempts < 5 && publish.mock.calls.length < 2;
      attempts++
    ) {
      await Promise.resolve();
    }
    expect(publish).toHaveBeenCalledTimes(2);

    resolveOtp("654321");
    await Promise.all([firstPublish, secondPublish]);

    expect(publish).toHaveBeenCalledTimes(4);
    expect(publish).toHaveBeenNthCalledWith(1, undefined, "latest");
    expect(publish).toHaveBeenNthCalledWith(2, undefined, "latest");
    expect(publish).toHaveBeenNthCalledWith(3, "654321", "latest");
    expect(publish).toHaveBeenNthCalledWith(4, "654321", "latest");
    expect(secondOperation.prompts).toEqual([]);
  });

  it("fails npm OTP publishing after three rejected prompt attempts", async () => {
    const publish = vi.fn(async () => false);
    const registry = createRegistry({ publish });
    registerDescriptor("npm", registry);
    const operation = createOperation(["111111", "222222", "333333"]);

    await expect(
      runPublish(
        "npm",
        "packages/pkg::js",
        createContext({ promptEnabled: true }),
        operation,
      ),
    ).rejects.toThrow("error.npm.otpFailed");

    expect(publish).toHaveBeenCalledTimes(4);
    expect(operation.prompts).toEqual(["111111", "222222", "333333"]);
    expect(operation.output).toBe("task.npm.otpFailed");
  });

  it("skips npm-like versions that are already published", async () => {
    const registry = createRegistry({
      isVersionPublished: vi.fn(async () => true),
    });
    registerDescriptor("npm", registry);
    const operation = await runPublish("npm", "packages/pkg::js");

    expect(operation.skip).toHaveBeenCalled();
    expect(operation.title).toContain("task.npm.skipped");
    expect(registry.publish).not.toHaveBeenCalled();
  });

  it("marks already-published dry runs as skipped for registry-specific titles", async () => {
    const cases = [
      {
        key: "npm",
        packageKey: "packages/pkg::js",
        registry: createRegistry({
          isVersionPublished: vi.fn(async () => true),
        }),
        title: "task.dryRun.npm.skipped",
      },
      {
        key: "jsr",
        packageKey: "packages/pkg::js",
        registry: createRegistry({
          isVersionPublished: vi.fn(async () => true),
        }),
        title: "task.dryRun.jsr.skipped",
      },
      {
        key: "crates",
        packageKey: "crates/root::rust",
        registry: createRegistry({
          isVersionPublished: vi.fn(async () => true),
          packageName: "crate-root",
          publishProvenance: undefined,
        }),
        title: "task.dryRun.crates.skipped",
      },
      {
        key: "custom",
        packageKey: "packages/pkg::js",
        registry: createRegistry({
          isVersionPublished: vi.fn(async () => true),
          publishProvenance: undefined,
        }),
        title: "[SKIPPED]",
      },
    ];

    for (const item of cases) {
      registerDescriptor(item.key, item.registry);
      const operation = await runDryRun(item.key, item.packageKey);
      expect(operation.skip).toHaveBeenCalled();
      expect(operation.title).toContain(item.title);
      expect(item.registry.dryRunPublish).not.toHaveBeenCalled();
    }
  });

  it("falls back to the package path when a registry has no package name", async () => {
    let registry = createRegistry({
      packageName: "",
      publishProvenance: undefined,
    });
    registerDescriptor("custom", registry);
    let operation = await runPublish("custom", "packages/pkg::js");

    expect(operation.title).toBe("packages/pkg");

    registry = createRegistry({
      packageName: "",
      publishProvenance: undefined,
    });
    registerDescriptor("custom", registry);
    operation = await runDryRun("custom", "packages/pkg::js");

    expect(operation.title).toBe("packages/pkg");
  });

  it("completes interactive JSR package creation and opens the creation URL", async () => {
    const registry = createRegistry({
      packageCreationUrls: ["https://jsr.test/new"],
      publish: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true),
    });
    registerDescriptor("jsr", registry);
    const ctx = createContext({ promptEnabled: true });
    const operation = createOperation([""]);

    await runPublish("jsr", "packages/pkg::js", ctx, operation);

    expect(registryState.openUrls).toEqual(["https://jsr.test/new"]);
    expect(operation.title).toContain("task.jsr.packageCreated");
  });

  it("requires a JSR token in noninteractive mode", async () => {
    process.env.JSR_TOKEN = "";
    const registry = createRegistry();
    registerDescriptor("jsr", registry);

    await expect(runPublish("jsr", "packages/pkg::js")).rejects.toThrow(
      "error.jsr.noToken",
    );
  });

  it("fails JSR publish when creation has no URL to complete", async () => {
    const registry = createRegistry({
      packageCreationUrls: [],
      publish: vi.fn(async () => false),
    });
    registerDescriptor("jsr", registry);

    await expect(
      runPublish(
        "jsr",
        "packages/pkg::js",
        createContext({ promptEnabled: true }),
      ),
    ).rejects.toThrow("error.jsr.creationFailed");
  });

  it("publishes crates and registers yank rollback", async () => {
    const registry = createRegistry({
      packageName: "crate-root",
      publishProvenance: undefined,
    });
    registerDescriptor("crates", registry);
    const ctx = createContext({ promptEnabled: true });

    await runPublish("crates", "crates/root::rust", ctx);

    expect(registry.publish).toHaveBeenCalledWith("latest");
    expect(rollbackItems(ctx)[0]?.label).toContain(
      "task.crates.rollbackBurned",
    );
  });

  it("registers skipped rollback for crates when unpublish is not enabled", async () => {
    const registry = createRegistry({
      packageName: "crate-root",
      publishProvenance: undefined,
    });
    registerDescriptor("crates", registry);
    const ctx = createContext();

    await runPublish("crates", "crates/root::rust", ctx);

    expect(rollbackItems(ctx)).toHaveLength(1);
    expect(rollbackItems(ctx)[0]?.label).toContain(
      "task.crates.rollbackSkipped",
    );
    expect(rollbackItems(ctx)[0]?.confirm).toBeUndefined();
  });

  it("does not register rollback for registries without unpublish support", async () => {
    const cases = [
      {
        key: "npm",
        packageKey: "packages/pkg::js",
        registry: createRegistry({ supportsUnpublish: false }),
      },
      {
        key: "crates",
        packageKey: "crates/root::rust",
        registry: createRegistry({
          packageName: "crate-root",
          publishProvenance: undefined,
          supportsUnpublish: false,
        }),
      },
      {
        key: "custom",
        packageKey: "packages/pkg::js",
        registry: createRegistry({
          publishProvenance: undefined,
          supportsUnpublish: false,
        }),
      },
    ];

    for (const item of cases) {
      registerDescriptor(item.key, item.registry);
      const ctx = createContext({ promptEnabled: true });
      await runPublish(item.key, item.packageKey, ctx);
      expect(rollbackItems(ctx)).toEqual([]);
    }
  });

  it("registers generic rollback for non-npm custom registries", async () => {
    const registry = createRegistry({
      packageName: "pkg",
      publishProvenance: undefined,
    });
    registerDescriptor("custom", registry, { label: "Custom Registry" });
    const ctx = createContext({
      promptEnabled: false,
    });
    ctx.config.rollback.dangerouslyAllowUnpublish = true;

    await runPublish("custom", "packages/pkg::js", ctx);

    expect(rollbackItems(ctx)[0]?.label).toBe(
      "Unpublish pkg@1.2.3 from Custom Registry",
    );
    await rollbackItems(ctx)[0]?.fn();
    expect(registry.unpublish).toHaveBeenCalledWith("pkg", "1.2.3");
  });

  it("registers skipped generic rollback until unpublish is explicitly allowed", async () => {
    const registry = createRegistry({
      packageName: "pkg",
      publishProvenance: undefined,
    });
    registerDescriptor("custom", registry, { label: "Custom Registry" });
    const ctx = createContext();

    await runPublish("custom", "packages/pkg::js", ctx);

    expect(rollbackItems(ctx)).toHaveLength(1);
    expect(rollbackItems(ctx)[0]?.label).toBe(
      "Unpublish pkg@1.2.3 from Custom Registry (skipped - use --dangerously-allow-unpublish to enable)",
    );
    expect(rollbackItems(ctx)[0]?.confirm).toBeUndefined();
  });

  it("runs generic registry dry-runs through the shared token retry wrapper", async () => {
    const registry = createRegistry({
      publishProvenance: undefined,
    });
    registerDescriptor("custom", registry, { label: "Custom Registry" });
    const operation = await runDryRun("custom", "packages/pkg::js");

    expect(operation.output).toBe("Running Custom Registry dry-run publish...");
    expect(registry.dryRunPublish).toHaveBeenCalledWith("latest");
  });

  it("retries dry-run auth failures when prompts are available", async () => {
    const registry = createRegistry({
      dryRunPublish: vi
        .fn()
        .mockRejectedValueOnce(new Error("401 unauthorized"))
        .mockResolvedValueOnce(undefined),
    });
    registerDescriptor("npm", registry);
    const ctx = createContext({ promptEnabled: true });
    const operation = createOperation(["new-token"]);

    await runDryRun("npm", "packages/pkg::js", ctx, operation);

    expect(registry.dryRunPublish).toHaveBeenCalledTimes(2);
    expect(registryState.secureSets).toEqual([["npm-token", "new-token"]]);
    expect(process.env.NODE_AUTH_TOKEN).toBe("new-token");
  });

  it("reuses an existing dry-run token retry promise before retrying", async () => {
    const registry = createRegistry({
      dryRunPublish: vi
        .fn()
        .mockRejectedValueOnce(new Error("401 unauthorized"))
        .mockResolvedValueOnce(undefined),
    });
    registerDescriptor("npm", registry);
    const ctx = createContext({
      promptEnabled: true,
      tokenRetryPromises: { npm: Promise.resolve("shared-token") },
    });
    const operation = createOperation(["should-not-prompt"]);

    await runDryRun("npm", "packages/pkg::js", ctx, operation);

    expect(registry.dryRunPublish).toHaveBeenCalledTimes(2);
    expect(operation.prompts).toEqual([]);
    expect(registryState.secureSets).toEqual([]);
  });

  it("does not prompt for dry-run auth failures in noninteractive mode", async () => {
    const registry = createRegistry({
      dryRunPublish: vi.fn(async () => {
        throw new Error("403 forbidden");
      }),
    });
    registerDescriptor("npm", registry);
    const operation = createOperation(["new-token"]);

    await expect(
      runDryRun("npm", "packages/pkg::js", createContext(), operation),
    ).rejects.toThrow("403 forbidden");
    expect(operation.prompts).toEqual([]);
  });

  it("throws when a registry descriptor or factory result is missing", async () => {
    await expect(runPublish("missing", "packages/pkg::js")).rejects.toThrow(
      /No registry descriptor registered/,
    );

    registryState.descriptors.set("broken", {
      key: "broken",
      label: "Broken",
      tokenConfig: {
        dbKey: "broken-token",
        envVar: "BROKEN_TOKEN",
        promptLabel: "broken token",
      },
      factory: vi.fn(async () => undefined),
    });

    await expect(runPublish("broken", "packages/pkg::js")).rejects.toThrow(
      /factory did not return/,
    );
  });

  it("fails npm publish in CI when token or provenance confirmation is missing", async () => {
    process.env.NODE_AUTH_TOKEN = "";
    let registry = createRegistry();
    registerDescriptor("npm", registry);

    await expect(runPublish("npm", "packages/pkg::js")).rejects.toThrow(
      "error.npm.noAuthToken",
    );

    process.env.NODE_AUTH_TOKEN = "token";
    registry = createRegistry({
      publishProvenance: vi.fn(async () => false),
    });
    registerDescriptor("npm", registry);

    await expect(runPublish("npm", "packages/pkg::js")).rejects.toThrow(
      "error.npm.2faInCi",
    );
  });

  it("uses custom npm token environment names in CI errors", async () => {
    delete process.env.CUSTOM_NPM_TOKEN;
    const registry = createRegistry();
    registerDescriptor("npm", registry, {
      tokenConfig: {
        dbKey: "custom-npm-token",
        envVar: "CUSTOM_NPM_TOKEN",
        promptLabel: "custom npm token",
      },
    });

    await expect(runPublish("npm", "packages/pkg::js")).rejects.toThrow(
      "CUSTOM_NPM_TOKEN not found in environment variables.",
    );
  });

  it("marks npm, jsr, crates, and generic already-published errors as skipped", async () => {
    const cases = [
      {
        key: "npm",
        registry: createRegistry({
          publishProvenance: vi.fn(async () => {
            throw new Error("cannot publish over the previously published");
          }),
        }),
        title: "task.npm.skipped",
      },
      {
        key: "jsr",
        registry: createRegistry({
          publish: vi.fn(async () => {
            throw new Error("already published");
          }),
        }),
        title: "task.jsr.skipped",
      },
      {
        key: "crates",
        registry: createRegistry({
          packageName: "crate-root",
          publish: vi.fn(async () => {
            throw new Error("is already uploaded");
          }),
          publishProvenance: undefined,
        }),
        title: "task.crates.skipped",
      },
      {
        key: "custom",
        registry: createRegistry({
          publish: vi.fn(async () => {
            throw new Error("already uploaded");
          }),
          publishProvenance: undefined,
        }),
        title: "[SKIPPED]",
      },
    ];

    for (const item of cases) {
      registerDescriptor(item.key, item.registry);
      const operation = await runPublish(item.key, "packages/pkg::js");
      expect(operation.skip).toHaveBeenCalled();
      expect(operation.title).toContain(item.title);
    }
  });

  it("fails JSR package creation without prompts and after exhausted prompts", async () => {
    let registry = createRegistry({
      packageCreationUrls: ["https://jsr.test/new"],
      publish: vi.fn(async () => false),
    });
    registerDescriptor("jsr", registry);

    await expect(runPublish("jsr", "packages/pkg::js")).rejects.toThrow(
      "task.jsr.createPackage",
    );

    registry = createRegistry({
      packageCreationUrls: ["https://jsr.test/new"],
      publish: vi.fn(async () => false),
    });
    registerDescriptor("jsr", registry);

    await expect(
      runPublish(
        "jsr",
        "packages/pkg::js",
        createContext({ promptEnabled: true }),
        createOperation(["", "", ""]),
      ),
    ).rejects.toThrow("error.jsr.creationFailed");
    expect(registryState.openUrls).toContain("https://jsr.test/new");
  });

  it("fails generic publish when the registry reports incomplete publish", async () => {
    const registry = createRegistry({
      publish: vi.fn(async () => false),
      publishProvenance: undefined,
    });
    registerDescriptor("custom", registry, { label: "Custom Registry" });

    await expect(runPublish("custom", "packages/pkg::js")).rejects.toThrow(
      "Custom Registry publish did not complete",
    );
  });

  it("retries JSR dry-run auth failures and updates the shared token", async () => {
    const registry = createRegistry({
      dryRunPublish: vi
        .fn()
        .mockRejectedValueOnce(new Error("invalid token"))
        .mockResolvedValueOnce(undefined),
    });
    registerDescriptor("jsr", registry);
    const ctx = createContext({ promptEnabled: true });

    await runDryRun(
      "jsr",
      "packages/pkg::js",
      ctx,
      createOperation(["new-jsr-token"]),
    );

    expect(registry.dryRunPublish).toHaveBeenCalledTimes(2);
    expect(registryState.jsr.token).toBe("new-jsr-token");
  });

  it("skips crates dry-run when cargo reports an unpublished sibling crate", async () => {
    registryState.rustNames.set("crates/dep", "crate-dep");
    const registry = createRegistry({
      dryRunPublish: vi.fn(async () => {
        throw new Error("no matching package named `crate-dep` found");
      }),
      packageName: "crate-root",
      publishProvenance: undefined,
    });
    registerDescriptor("crates", registry);

    const operation = await runDryRun(
      "crates",
      "crates/root::rust",
      createContext(),
      createOperation(),
      ["crates/dep::rust"],
    );

    expect(operation.title).toContain("task.dryRun.crates.skippedSibling");
    expect(operation.skip).toHaveBeenCalledOnce();
  });

  it("skips crates dry-run when cargo reports a sibling version mismatch", async () => {
    registryState.rustNames.set("crates/dep", "crate-dep");
    const registry = createRegistry({
      dryRunPublish: vi.fn(async () => {
        throw new Error(
          "failed to select a version for the requirement `crate-dep`",
        );
      }),
      packageName: "crate-root",
      publishProvenance: undefined,
    });
    registerDescriptor("crates", registry);

    const operation = await runDryRun(
      "crates",
      "crates/root::rust",
      createContext(),
      createOperation(),
      ["crates/dep::rust"],
    );

    expect(operation.title).toContain("task.dryRun.crates.skippedSibling");
    expect(operation.skip).toHaveBeenCalledOnce();
  });

  it("rethrows crates dry-run missing-crate errors for non-sibling crates", async () => {
    registryState.rustNames.set("crates/dep", "crate-dep");
    const registry = createRegistry({
      dryRunPublish: vi.fn(async () => {
        throw new Error("no matching package named `external-crate` found");
      }),
      packageName: "crate-root",
      publishProvenance: undefined,
    });
    registerDescriptor("crates", registry);

    await expect(
      runDryRun(
        "crates",
        "crates/root::rust",
        createContext(),
        createOperation(),
        ["crates/dep::rust"],
      ),
    ).rejects.toThrow("external-crate");
  });

  it("skips crates dry-run when sibling dependencies are not yet published", async () => {
    registryState.rustDeps.set("crates/root", ["crate-dep"]);
    registryState.rustNames.set("crates/dep", "crate-dep");
    const registry = createRegistry({
      packageName: "crate-root",
      publishProvenance: undefined,
    });
    const siblingRegistry = createRegistry({
      packageName: "crate-dep",
      isVersionPublished: vi.fn(async () => false),
      publishProvenance: undefined,
    });
    registryState.descriptors.set("crates", {
      key: "crates",
      label: "crates",
      tokenConfig: {
        dbKey: "crates-token",
        envVar: "CARGO_REGISTRY_TOKEN",
        promptLabel: "crates token",
      },
      factory: vi.fn(async (packagePath: string) =>
        packagePath === "crates/dep" ? siblingRegistry : registry,
      ),
    });

    const operation = await runDryRun(
      "crates",
      "crates/root::rust",
      createContext(),
      createOperation(),
      ["crates/root::rust", "crates/dep::rust"],
    );

    expect(operation.title).toContain("task.dryRun.crates.skippedSibling");
    expect(operation.skip).toHaveBeenCalledOnce();
    expect(registry.dryRunPublish).not.toHaveBeenCalled();
  });

  it("continues crates dry-run when sibling dependencies are already published", async () => {
    registryState.rustDeps.set("crates/root", ["crate-dep"]);
    registryState.rustNames.set("crates/dep", "crate-dep");
    const registry = createRegistry({
      packageName: "crate-root",
      publishProvenance: undefined,
    });
    const siblingRegistry = createRegistry({
      packageName: "crate-dep",
      isVersionPublished: vi.fn(async () => true),
      publishProvenance: undefined,
    });
    registryState.descriptors.set("crates", {
      key: "crates",
      label: "crates",
      tokenConfig: {
        dbKey: "crates-token",
        envVar: "CARGO_REGISTRY_TOKEN",
        promptLabel: "crates token",
      },
      factory: vi.fn(async (packagePath: string) =>
        packagePath === "crates/dep" ? siblingRegistry : registry,
      ),
    });

    const operation = await runDryRun(
      "crates",
      "crates/root::rust",
      createContext(),
      createOperation(),
      ["crates/root::rust", "crates/dep::rust"],
    );

    expect(operation.title).toContain("task.dryRun.crates.title");
    expect(registry.dryRunPublish).toHaveBeenCalledWith("latest");
  });

  it("checks sibling publication status when no sibling version is planned", async () => {
    for (const published of [true, false]) {
      registryState.rustDeps.set("crates/root", ["crate-dep"]);
      registryState.rustNames.set("crates/dep", "crate-dep");
      const registry = createRegistry({
        packageName: "crate-root",
        publishProvenance: undefined,
      });
      const siblingRegistry = createRegistry({
        packageName: "crate-dep",
        isPublished: vi.fn(async () => published),
        publishProvenance: undefined,
      });
      registryState.descriptors.set("crates", {
        key: "crates",
        label: "crates",
        tokenConfig: {
          dbKey: "crates-token",
          envVar: "CARGO_REGISTRY_TOKEN",
          promptLabel: "crates token",
        },
        factory: vi.fn(async (packagePath: string) =>
          packagePath === "crates/dep" ? siblingRegistry : registry,
        ),
      });
      const ctx = createContext();
      const packages = ctx.runtime.versionPlan?.packages;
      packages?.delete("crates/dep::rust");

      const operation = await runDryRun(
        "crates",
        "crates/root::rust",
        ctx,
        createOperation(),
        ["crates/root::rust", "crates/dep::rust"],
      );

      expect(siblingRegistry.isPublished).toHaveBeenCalled();
      if (published) {
        expect(registry.dryRunPublish).toHaveBeenCalledWith("latest");
      } else {
        expect(operation.title).toContain("task.dryRun.crates.skippedSibling");
        expect(operation.skip).toHaveBeenCalledOnce();
        expect(registry.dryRunPublish).not.toHaveBeenCalled();
      }

      registryState.rustDeps.clear();
      registryState.rustNames.clear();
      registryState.descriptors.clear();
    }
  });
});
