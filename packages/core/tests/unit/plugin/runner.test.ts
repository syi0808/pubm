import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CompressedAsset,
  PreparedAsset,
  ResolvedAsset,
  TransformedAsset,
  UploadedAsset,
} from "../../../src/assets/types.js";
import {
  type EcosystemDescriptor,
  ecosystemCatalog,
} from "../../../src/ecosystem/catalog.js";
import { PluginRunner } from "../../../src/plugin/runner.js";
import type {
  PluginRegistryDefinition,
  PubmPlugin,
} from "../../../src/plugin/types.js";
import { registryCatalog } from "../../../src/registry/catalog.js";

function makeCtx() {
  return {
    config: { packages: [{ path: ".", registries: ["npm"] }] },
    options: {
      testScript: "test",
      buildScript: "build",
      branch: "main",
      tag: "latest",
      saveToken: true,
    },
    cwd: process.cwd(),
    runtime: {
      version: "1.0.0",
      tag: "latest",
      promptEnabled: false,
      cleanWorkingTree: true,
      pluginRunner: {} as any,
    },
  } as any;
}

describe("PluginRunner", () => {
  it("executes hooks in registration order", async () => {
    const order: number[] = [];
    const plugin1: PubmPlugin = {
      name: "plugin-1",
      hooks: {
        beforePublish: () => {
          order.push(1);
        },
      },
    };
    const plugin2: PubmPlugin = {
      name: "plugin-2",
      hooks: {
        beforePublish: () => {
          order.push(2);
        },
      },
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    await runner.runHook("beforePublish", makeCtx());

    expect(order).toEqual([1, 2]);
  });

  it("passes error to onError hooks", async () => {
    const errorSpy = vi.fn();
    const plugin: PubmPlugin = {
      name: "error-plugin",
      hooks: {
        onError: errorSpy,
      },
    };

    const runner = new PluginRunner([plugin]);
    const ctx = makeCtx();
    const error = new Error("publish failed");
    await runner.runErrorHook(ctx, error);

    expect(errorSpy).toHaveBeenCalledWith(ctx, error);
  });

  it("handles plugins without hooks gracefully", async () => {
    const plugin: PubmPlugin = {
      name: "no-hooks",
    };

    const runner = new PluginRunner([plugin]);
    await expect(
      runner.runHook("beforePublish", makeCtx()),
    ).resolves.toBeUndefined();
    await expect(
      runner.runErrorHook(makeCtx(), new Error("fail")),
    ).resolves.toBeUndefined();
  });

  it("propagates hook errors", async () => {
    const plugin: PubmPlugin = {
      name: "failing-plugin",
      hooks: {
        beforePublish: () => {
          throw new Error("hook failed");
        },
      },
    };

    const runner = new PluginRunner([plugin]);
    await expect(runner.runHook("beforePublish", makeCtx())).rejects.toThrow(
      "hook failed",
    );
  });

  it("stops subsequent plugins when first plugin hook throws", async () => {
    const secondHookSpy = vi.fn();
    const plugin1: PubmPlugin = {
      name: "failing-plugin",
      hooks: {
        beforeBuild: () => {
          throw new Error("first plugin error");
        },
      },
    };
    const plugin2: PubmPlugin = {
      name: "second-plugin",
      hooks: {
        beforeBuild: secondHookSpy,
      },
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    await expect(runner.runHook("beforeBuild", makeCtx())).rejects.toThrow(
      "first plugin error",
    );
    expect(secondHookSpy).not.toHaveBeenCalled();
  });

  it("handles empty plugin list", async () => {
    const runner = new PluginRunner([]);
    await expect(
      runner.runHook("beforePublish", makeCtx()),
    ).resolves.toBeUndefined();
    await expect(
      runner.runErrorHook(makeCtx(), new Error("fail")),
    ).resolves.toBeUndefined();
  });

  it("passes release context to afterRelease hooks", async () => {
    const afterRelease = vi.fn();
    const runner = new PluginRunner([
      {
        name: "release-plugin",
        hooks: {
          afterRelease,
        },
      },
    ]);
    const ctx = makeCtx();
    const releaseCtx = {
      version: "1.0.0",
      tag: "v1.0.0",
      releaseUrl: "https://github.com/pubm/pubm/releases/tag/v1.0.0",
      assets: [],
    };

    await runner.runAfterReleaseHook(ctx, releaseCtx);

    expect(afterRelease).toHaveBeenCalledWith(ctx, releaseCtx);
  });

  describe("collectAssetHooks", () => {
    function makeResolvedAsset(filePath: string): ResolvedAsset {
      return {
        filePath,
        platform: { raw: "linux-x64" },
        config: { path: filePath, compress: false, name: filePath },
      };
    }

    function makeTransformedAsset(filePath: string): TransformedAsset {
      return {
        ...makeResolvedAsset(filePath),
      };
    }

    function makeCompressedAsset(filePath: string): CompressedAsset {
      return {
        filePath,
        originalPath: filePath,
        platform: { raw: "linux-x64" },
        compressFormat: false,
        config: { path: filePath, compress: false, name: filePath },
      };
    }

    function makePreparedAsset(filePath: string): PreparedAsset {
      return {
        ...makeCompressedAsset(filePath),
        name: filePath,
        sha256: "abc123",
      };
    }

    function makeUploadedAsset(
      filePath: string,
      target: string,
    ): UploadedAsset {
      return {
        ...makePreparedAsset(filePath),
        url: `https://example.com/${filePath}`,
        target,
      };
    }

    // --- resolveAssets ---

    it("returns no resolveAssets hook when no plugins provide it", () => {
      const runner = new PluginRunner([{ name: "no-hooks" }]);
      const hooks = runner.collectAssetHooks();
      expect(hooks.resolveAssets).toBeUndefined();
    });

    it("resolveAssets with 1 plugin", async () => {
      const plugin: PubmPlugin = {
        name: "resolve-1",
        hooks: {
          resolveAssets: async (assets) => [
            ...assets,
            makeResolvedAsset("extra.bin"),
          ],
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.resolveAssets!(
        [makeResolvedAsset("a.bin")],
        makeCtx(),
      );
      expect(result).toHaveLength(2);
      expect(result[1].filePath).toBe("extra.bin");
    });

    it("resolveAssets chains multiple plugins sequentially", async () => {
      const plugin1: PubmPlugin = {
        name: "resolve-1",
        hooks: {
          resolveAssets: async (assets) => [
            ...assets,
            makeResolvedAsset("from-p1"),
          ],
        },
      };
      const plugin2: PubmPlugin = {
        name: "resolve-2",
        hooks: {
          resolveAssets: async (assets) => [
            ...assets,
            makeResolvedAsset("from-p2"),
          ],
        },
      };
      const runner = new PluginRunner([plugin1, plugin2]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.resolveAssets!([], makeCtx());
      expect(result).toHaveLength(2);
      expect(result[0].filePath).toBe("from-p1");
      expect(result[1].filePath).toBe("from-p2");
    });

    // --- transformAsset ---

    it("returns no transformAsset hook when no plugins provide it", () => {
      const runner = new PluginRunner([{ name: "no-hooks" }]);
      const hooks = runner.collectAssetHooks();
      expect(hooks.transformAsset).toBeUndefined();
    });

    it("transformAsset with 1 plugin returning single asset", async () => {
      const plugin: PubmPlugin = {
        name: "transform-1",
        hooks: {
          transformAsset: async (asset) => ({
            ...asset,
            filePath: `${asset.filePath}.transformed`,
          }),
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.transformAsset!(
        makeResolvedAsset("a.bin"),
        makeCtx(),
      );
      expect(Array.isArray(result) ? result[0].filePath : result.filePath).toBe(
        "a.bin.transformed",
      );
    });

    it("transformAsset supports array fan-out from a single plugin", async () => {
      const plugin: PubmPlugin = {
        name: "transform-fanout",
        hooks: {
          transformAsset: async (asset) => [
            { ...asset, filePath: `${asset.filePath}.a` },
            { ...asset, filePath: `${asset.filePath}.b` },
          ],
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.transformAsset!(
        makeResolvedAsset("x"),
        makeCtx(),
      );
      expect(Array.isArray(result)).toBe(true);
      const arr = result as TransformedAsset[];
      expect(arr).toHaveLength(2);
      expect(arr[0].filePath).toBe("x.a");
      expect(arr[1].filePath).toBe("x.b");
    });

    it("transformAsset chains multiple plugins with fan-out", async () => {
      const plugin1: PubmPlugin = {
        name: "transform-1",
        hooks: {
          transformAsset: async (asset) => [
            { ...asset, filePath: `${asset.filePath}.1a` },
            { ...asset, filePath: `${asset.filePath}.1b` },
          ],
        },
      };
      const plugin2: PubmPlugin = {
        name: "transform-2",
        hooks: {
          transformAsset: async (asset) => ({
            ...asset,
            filePath: `${asset.filePath}.2`,
          }),
        },
      };
      const runner = new PluginRunner([plugin1, plugin2]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.transformAsset!(
        makeResolvedAsset("x"),
        makeCtx(),
      );
      const arr = result as TransformedAsset[];
      expect(arr).toHaveLength(2);
      expect(arr[0].filePath).toBe("x.1a.2");
      expect(arr[1].filePath).toBe("x.1b.2");
    });

    it("transformAsset returns single item unwrapped when only 1 result", async () => {
      const plugin: PubmPlugin = {
        name: "transform-single",
        hooks: {
          transformAsset: async (asset) => asset,
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.transformAsset!(
        makeResolvedAsset("x"),
        makeCtx(),
      );
      expect(Array.isArray(result)).toBe(false);
    });

    // --- compressAsset ---

    it("returns no compressAsset hook when no plugins provide it", () => {
      const runner = new PluginRunner([{ name: "no-hooks" }]);
      const hooks = runner.collectAssetHooks();
      expect(hooks.compressAsset).toBeUndefined();
    });

    it("compressAsset with 1 plugin", async () => {
      const plugin: PubmPlugin = {
        name: "compress-1",
        hooks: {
          compressAsset: async (asset) => ({
            ...makeCompressedAsset(asset.filePath),
            compressFormat: "tar.gz" as const,
          }),
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.compressAsset!(
        makeTransformedAsset("a.bin"),
        makeCtx(),
      );
      expect(result.compressFormat).toBe("tar.gz");
    });

    it("compressAsset chains multiple plugins sequentially", async () => {
      const plugin1: PubmPlugin = {
        name: "compress-1",
        hooks: {
          compressAsset: async (asset) => ({
            ...makeCompressedAsset(asset.filePath),
            filePath: `${asset.filePath}.gz`,
            compressFormat: "tar.gz" as const,
          }),
        },
      };
      const plugin2: PubmPlugin = {
        name: "compress-2",
        hooks: {
          compressAsset: async (asset) => ({
            ...makeCompressedAsset(asset.filePath),
            filePath: `${asset.filePath}.zst`,
            compressFormat: "tar.zst" as const,
          }),
        },
      };
      const runner = new PluginRunner([plugin1, plugin2]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.compressAsset!(
        makeTransformedAsset("a.bin"),
        makeCtx(),
      );
      expect(result.filePath).toBe("a.bin.gz.zst");
      expect(result.compressFormat).toBe("tar.zst");
    });

    // --- nameAsset ---

    it("returns no nameAsset hook when no plugins provide it", () => {
      const runner = new PluginRunner([{ name: "no-hooks" }]);
      const hooks = runner.collectAssetHooks();
      expect(hooks.nameAsset).toBeUndefined();
    });

    it("nameAsset with 1 plugin", () => {
      const plugin: PubmPlugin = {
        name: "name-1",
        hooks: {
          nameAsset: (_asset) => "custom-name.tar.gz",
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = hooks.nameAsset!(makeCompressedAsset("a.bin"), makeCtx());
      expect(result).toBe("custom-name.tar.gz");
    });

    it("nameAsset with multiple plugins uses last one's result", () => {
      const plugin1: PubmPlugin = {
        name: "name-1",
        hooks: {
          nameAsset: (_asset) => "first-name",
        },
      };
      const plugin2: PubmPlugin = {
        name: "name-2",
        hooks: {
          nameAsset: (_asset) => "second-name",
        },
      };
      const runner = new PluginRunner([plugin1, plugin2]);
      const hooks = runner.collectAssetHooks();
      const result = hooks.nameAsset!(makeCompressedAsset("a.bin"), makeCtx());
      expect(result).toBe("second-name");
    });

    // --- generateChecksums ---

    it("returns no generateChecksums hook when no plugins provide it", () => {
      const runner = new PluginRunner([{ name: "no-hooks" }]);
      const hooks = runner.collectAssetHooks();
      expect(hooks.generateChecksums).toBeUndefined();
    });

    it("generateChecksums with 1 plugin", async () => {
      const plugin: PubmPlugin = {
        name: "checksum-1",
        hooks: {
          generateChecksums: async (assets) =>
            assets.map((a) => ({ ...a, sha256: "checksum1" })),
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.generateChecksums!(
        [makePreparedAsset("a.bin")],
        makeCtx(),
      );
      expect(result[0].sha256).toBe("checksum1");
    });

    it("generateChecksums chains multiple plugins", async () => {
      const plugin1: PubmPlugin = {
        name: "checksum-1",
        hooks: {
          generateChecksums: async (assets) =>
            assets.map((a) => ({ ...a, sha256: "from-p1" })),
        },
      };
      const plugin2: PubmPlugin = {
        name: "checksum-2",
        hooks: {
          generateChecksums: async (assets) =>
            assets.map((a) => ({
              ...a,
              sha256: `${a.sha256}+from-p2`,
            })),
        },
      };
      const runner = new PluginRunner([plugin1, plugin2]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.generateChecksums!(
        [makePreparedAsset("a.bin")],
        makeCtx(),
      );
      expect(result[0].sha256).toBe("from-p1+from-p2");
    });

    // --- uploadAssets ---

    it("returns no uploadAssets hook when no plugins provide it", () => {
      const runner = new PluginRunner([{ name: "no-hooks" }]);
      const hooks = runner.collectAssetHooks();
      expect(hooks.uploadAssets).toBeUndefined();
    });

    it("uploadAssets with 1 plugin", async () => {
      const plugin: PubmPlugin = {
        name: "upload-1",
        hooks: {
          uploadAssets: async (assets) =>
            assets.map((a) => makeUploadedAsset(a.filePath, "github")),
        },
      };
      const runner = new PluginRunner([plugin]);
      const hooks = runner.collectAssetHooks();
      const result = await hooks.uploadAssets!(
        [makePreparedAsset("a.bin")],
        makeCtx(),
      );
      expect(result).toHaveLength(1);
      expect(result[0].target).toBe("github");
    });

    it("uploadAssets concatenates results from multiple plugins", async () => {
      const plugin1: PubmPlugin = {
        name: "upload-github",
        hooks: {
          uploadAssets: async (assets) =>
            assets.map((a) => makeUploadedAsset(a.filePath, "github")),
        },
      };
      const plugin2: PubmPlugin = {
        name: "upload-s3",
        hooks: {
          uploadAssets: async (assets) =>
            assets.map((a) => makeUploadedAsset(a.filePath, "s3")),
        },
      };
      const runner = new PluginRunner([plugin1, plugin2]);
      const hooks = runner.collectAssetHooks();
      const input = [makePreparedAsset("a.bin")];
      const result = await hooks.uploadAssets!(input, makeCtx());
      expect(result).toHaveLength(2);
      expect(result[0].target).toBe("github");
      expect(result[1].target).toBe("s3");
    });

    it("returns empty collected hooks when no plugins have any asset hooks", () => {
      const runner = new PluginRunner([
        { name: "p1" },
        { name: "p2", hooks: { beforePublish: () => {} } },
      ]);
      const hooks = runner.collectAssetHooks();
      expect(hooks.resolveAssets).toBeUndefined();
      expect(hooks.transformAsset).toBeUndefined();
      expect(hooks.compressAsset).toBeUndefined();
      expect(hooks.nameAsset).toBeUndefined();
      expect(hooks.generateChecksums).toBeUndefined();
      expect(hooks.uploadAssets).toBeUndefined();
    });
  });

  describe("collectCredentials", () => {
    it("collects credentials from all plugins", () => {
      const plugin1: PubmPlugin = {
        name: "plugin-1",
        credentials: () => [
          { key: "token-a", env: "TOKEN_A", label: "Token A" },
        ],
      };
      const plugin2: PubmPlugin = {
        name: "plugin-2",
        credentials: () => [
          { key: "token-b", env: "TOKEN_B", label: "Token B" },
        ],
      };

      const runner = new PluginRunner([plugin1, plugin2]);
      const creds = runner.collectCredentials(makeCtx());

      expect(creds).toHaveLength(2);
      expect(creds[0].key).toBe("token-a");
      expect(creds[1].key).toBe("token-b");
    });

    it("deduplicates by key (first-wins)", () => {
      const plugin1: PubmPlugin = {
        name: "plugin-1",
        credentials: () => [
          { key: "shared", env: "SHARED_TOKEN", label: "From plugin 1" },
        ],
      };
      const plugin2: PubmPlugin = {
        name: "plugin-2",
        credentials: () => [
          { key: "shared", env: "SHARED_TOKEN", label: "From plugin 2" },
        ],
      };

      const runner = new PluginRunner([plugin1, plugin2]);
      const creds = runner.collectCredentials(makeCtx());

      expect(creds).toHaveLength(1);
      expect(creds[0].label).toBe("From plugin 1");
    });

    it("returns empty array when no plugins have credentials", () => {
      const plugin: PubmPlugin = { name: "no-creds" };
      const runner = new PluginRunner([plugin]);

      expect(runner.collectCredentials(makeCtx())).toEqual([]);
    });
  });

  describe("collectChecks", () => {
    it("collects checks filtered by phase", () => {
      const plugin: PubmPlugin = {
        name: "check-plugin",
        checks: () => [
          {
            title: "Pre check",
            phase: "prerequisites" as const,
            task: vi.fn(),
          },
          { title: "Cond check", phase: "conditions" as const, task: vi.fn() },
        ],
      };

      const runner = new PluginRunner([plugin]);

      expect(runner.collectChecks(makeCtx(), "prerequisites")).toHaveLength(1);
      expect(runner.collectChecks(makeCtx(), "prerequisites")[0].title).toBe(
        "Pre check",
      );
      expect(runner.collectChecks(makeCtx(), "conditions")).toHaveLength(1);
      expect(runner.collectChecks(makeCtx(), "conditions")[0].title).toBe(
        "Cond check",
      );
    });

    it("returns empty array when no plugins have checks", () => {
      const plugin: PubmPlugin = { name: "no-checks" };
      const runner = new PluginRunner([plugin]);

      expect(runner.collectChecks(makeCtx(), "prerequisites")).toEqual([]);
    });
  });

  describe("descriptor registration", () => {
    function createTestPluginRegistryDef(
      overrides: Partial<PluginRegistryDefinition> = {},
    ): PluginRegistryDefinition {
      return {
        key: "test-registry",
        ecosystem: "js",
        label: "Test",
        tokenConfig: {
          envVar: "TEST_TOKEN",
          dbKey: "test-token",
          ghSecretName: "TEST_TOKEN",
          promptLabel: "test",
          tokenUrl: "https://example.com",
          tokenUrlLabel: "example.com",
        },
        needsPackageScripts: false,
        concurrentPublish: true,
        unpublishLabel: "Unpublish",
        requiresEarlyAuth: false,
        connector: () => ({}) as any,
        factory: async () => ({}) as any,
        ...overrides,
      };
    }

    afterEach(() => {
      registryCatalog.remove("plugin-reg");
      registryCatalog.remove("plugin-reg-with-tasks");
      ecosystemCatalog.remove("test-eco");
    });

    it("registers plugin registry definitions into registryCatalog", () => {
      const def = createTestPluginRegistryDef({ key: "plugin-reg" });
      const plugin: PubmPlugin = {
        name: "test-plugin",
        registries: [def],
      };

      new PluginRunner([plugin]);
      const registered = registryCatalog.get("plugin-reg");
      expect(registered).toBeDefined();
      expect(registered?.key).toBe("plugin-reg");
      expect(registered?.label).toBe("Test");
    });

    it("maps createPublishTask/createDryRunTask to internal taskFactory", () => {
      const publishFn = vi.fn();
      const dryRunFn = vi.fn();
      const def = createTestPluginRegistryDef({
        key: "plugin-reg-with-tasks",
        createPublishTask: publishFn,
        createDryRunTask: dryRunFn,
      });
      const plugin: PubmPlugin = {
        name: "test-plugin",
        registries: [def],
      };

      new PluginRunner([plugin]);
      const registered = registryCatalog.get("plugin-reg-with-tasks");
      expect(registered?.taskFactory).toBeDefined();
      expect(registered?.taskFactory?.createPublishTask).toBe(publishFn);
      expect(registered?.taskFactory?.createDryRunTask).toBe(dryRunFn);
    });

    it("sets taskFactory to undefined when createPublishTask not provided", () => {
      const def = createTestPluginRegistryDef({ key: "plugin-reg" });
      const plugin: PubmPlugin = {
        name: "test-plugin",
        registries: [def],
      };

      new PluginRunner([plugin]);
      const registered = registryCatalog.get("plugin-reg");
      expect(registered?.taskFactory).toBeUndefined();
    });

    it("registers plugin ecosystem descriptors into ecosystemCatalog", () => {
      const desc: EcosystemDescriptor = {
        key: "test-eco",
        label: "Test Ecosystem",
        defaultRegistries: [],
        ecosystemClass: class {} as any,
        detect: async () => false,
      };
      const plugin: PubmPlugin = {
        name: "test-plugin",
        ecosystems: [desc],
      };

      new PluginRunner([plugin]);
      expect(ecosystemCatalog.get("test-eco")).toBe(desc);
    });
  });
});
