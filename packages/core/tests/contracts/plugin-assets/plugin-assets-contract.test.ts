import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { basename, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAssetPipeline } from "../../../src/assets/pipeline.js";
import {
  normalizeConfig,
  resolveAssets,
} from "../../../src/assets/resolver.js";
import type {
  CompressedAsset,
  PreparedAsset,
  ReleaseContext,
  TransformedAsset,
  UploadedAsset,
} from "../../../src/assets/types.js";
import { PluginRunner } from "../../../src/plugin/runner.js";
import type {
  PluginRegistryDefinition,
  PubmPlugin,
} from "../../../src/plugin/types.js";
import {
  RegistryCatalog,
  registerPrivateRegistry,
  registryCatalog,
} from "../../../src/registry/catalog.js";

const fixturePath = path.resolve(__dirname, "../../fixtures/basic");
const pluginRegistryKey = "contract-plugin-registry";
const tempRoots: string[] = [];

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      packages: [
        {
          name: "@pubm/contract-plugin",
          path: ".",
          registries: ["npm"],
          ecosystem: "js",
          version: "1.0.0",
          dependencies: [],
        },
      ],
    },
    options: {
      tag: "latest",
      branch: "main",
    },
    cwd: process.cwd(),
    runtime: {
      version: "1.0.0",
      tag: "latest",
      promptEnabled: false,
      cleanWorkingTree: true,
    },
    ...overrides,
  } as any;
}

function makeUploadedAsset(
  asset: PreparedAsset,
  target: string,
): UploadedAsset {
  return {
    ...asset,
    target,
    url: `https://assets.example.test/${asset.name}`,
  };
}

afterEach(() => {
  registryCatalog.remove(pluginRegistryKey);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("plugin/assets/custom registry contract", () => {
  it("runs plugin hooks in registration order with the shared pubm and release contexts", async () => {
    const ledger: string[] = [];
    const ctx = makeCtx();
    const releaseCtx: ReleaseContext = {
      displayLabel: "@pubm/contract-plugin",
      version: "1.2.3",
      tag: "v1.2.3",
      releaseUrl: "https://github.com/pubm/pubm/releases/tag/v1.2.3",
      assets: [],
    };

    const plugins: PubmPlugin[] = [
      {
        name: "contract-plugin-a",
        hooks: {
          beforePublish: (receivedCtx) => {
            expect(receivedCtx).toBe(ctx);
            ledger.push("a.beforePublish");
          },
          afterRelease: (receivedCtx, receivedReleaseCtx) => {
            expect(receivedCtx).toBe(ctx);
            expect(receivedReleaseCtx).toBe(releaseCtx);
            ledger.push("a.afterRelease");
          },
        },
      },
      {
        name: "contract-plugin-b",
        hooks: {
          beforePublish: (receivedCtx) => {
            expect(receivedCtx).toBe(ctx);
            ledger.push("b.beforePublish");
          },
          afterRelease: (receivedCtx, receivedReleaseCtx) => {
            expect(receivedCtx).toBe(ctx);
            expect(receivedReleaseCtx).toBe(releaseCtx);
            ledger.push("b.afterRelease");
          },
        },
      },
    ];

    const runner = new PluginRunner(plugins);

    await runner.runHook("beforePublish", ctx);
    await runner.runAfterReleaseHook(ctx, releaseCtx);

    expect(ledger).toEqual([
      "a.beforePublish",
      "b.beforePublish",
      "a.afterRelease",
      "b.afterRelease",
    ]);
  });

  it("registers plugin registries as catalog descriptors with executable fake boundaries", async () => {
    const ledger: string[] = [];
    const publishTask = vi.fn((packagePath: string) => ({
      title: `publish ${packagePath}`,
      task: async () => {
        ledger.push(`task.publish:${packagePath}`);
      },
    }));
    const dryRunTask = vi.fn((packagePath: string) => ({
      title: `dry-run ${packagePath}`,
      task: async () => {
        ledger.push(`task.dryRun:${packagePath}`);
      },
    }));
    const registryDefinition: PluginRegistryDefinition = {
      key: pluginRegistryKey,
      ecosystem: "js",
      label: "Contract Plugin Registry",
      tokenConfig: {
        envVar: "CONTRACT_PLUGIN_REGISTRY_TOKEN",
        dbKey: "contract-plugin-registry-token",
        ghSecretName: "CONTRACT_PLUGIN_REGISTRY_TOKEN",
        promptLabel: "contract plugin registry token",
        tokenUrl: "https://registry.example.test/tokens",
        tokenUrlLabel: "registry.example.test",
      },
      unpublishLabel: "Unpublish",
      requiresEarlyAuth: true,
      concurrentPublish: false,
      additionalEnvVars: (token) => {
        ledger.push("registry.additionalEnvVars");
        return { CONTRACT_PLUGIN_REGISTRY_EXTRA_TOKEN: token };
      },
      validateToken: async (token) => {
        ledger.push(`registry.validate:${token}`);
        return token === "valid-token";
      },
      connector: () => {
        ledger.push("registry.connector");
        return {} as any;
      },
      factory: async (packagePath) => {
        ledger.push(`registry.factory:${packagePath}`);
        return { packageName: "@pubm/contract-plugin" } as any;
      },
      createPublishTask: publishTask,
      createDryRunTask: dryRunTask,
    };

    new PluginRunner([
      {
        name: "contract-registry-plugin",
        registries: [registryDefinition],
      },
    ]);

    const registered = registryCatalog.get(pluginRegistryKey);

    expect(registered).toMatchObject({
      key: pluginRegistryKey,
      ecosystem: "js",
      label: "Contract Plugin Registry",
      tokenConfig: registryDefinition.tokenConfig,
      unpublishLabel: "Unpublish",
      requiresEarlyAuth: true,
      concurrentPublish: false,
    });
    expect(registered?.additionalEnvVars?.("valid-token")).toEqual({
      CONTRACT_PLUGIN_REGISTRY_EXTRA_TOKEN: "valid-token",
    });
    await expect(registered?.validateToken?.("valid-token")).resolves.toBe(
      true,
    );
    registered?.connector();
    await registered?.factory("packages/contract-plugin");

    const task = registered?.taskFactory?.createPublishTask(
      "packages/contract-plugin",
    );
    await task?.task?.(makeCtx(), {} as any);

    expect(registered?.taskFactory?.createPublishTask).toBe(publishTask);
    expect(registered?.taskFactory?.createDryRunTask).toBe(dryRunTask);
    expect(ledger).toEqual([
      "registry.additionalEnvVars",
      "registry.validate:valid-token",
      "registry.connector",
      "registry.factory:packages/contract-plugin",
      "task.publish:packages/contract-plugin",
    ]);
  });

  it("registers private custom registries into an isolated catalog and preserves the custom npm registry URL", async () => {
    const catalog = new RegistryCatalog();
    const registryUrl = "https://registry.contract.example/team-a/";

    const key = registerPrivateRegistry(
      {
        url: registryUrl,
        token: { envVar: "CONTRACT_PRIVATE_REGISTRY_TOKEN" },
      },
      "js",
      catalog,
    );
    const secondKey = registerPrivateRegistry(
      {
        url: registryUrl,
        token: { envVar: "CONTRACT_PRIVATE_REGISTRY_TOKEN" },
      },
      "js",
      catalog,
    );
    const descriptor = catalog.get(key);
    const packageRegistry = await descriptor?.factory(fixturePath);

    expect(key).toBe("registry.contract.example/team-a");
    expect(secondKey).toBe(key);
    expect(catalog.all()).toHaveLength(1);
    expect(descriptor).toMatchObject({
      key,
      ecosystem: "js",
      label: registryUrl,
      tokenConfig: {
        envVar: "CONTRACT_PRIVATE_REGISTRY_TOKEN",
        dbKey: `${key}-token`,
        ghSecretName: "CONTRACT_PRIVATE_REGISTRY_TOKEN",
        promptLabel: `Token for ${registryUrl}`,
        tokenUrl: registryUrl,
        tokenUrlLabel: key,
      },
      concurrentPublish: true,
      unpublishLabel: "Unpublish",
      requiresEarlyAuth: false,
    });
    expect(descriptor?.taskFactory?.createPublishTask).toBeTypeOf("function");
    expect(descriptor?.taskFactory?.createDryRunTask).toBeTypeOf("function");
    expect(packageRegistry?.packageName).toBe("test-package");
    expect(packageRegistry?.registry).toBe(registryUrl);
  });

  it("records resolve, transform, compress, name, and upload asset semantics without external effects", async () => {
    const root = makeTempRoot("pubm-contract-assets-");
    const tempDir = makeTempRoot("pubm-contract-assets-temp-");
    const distDir = join(root, "dist");
    const processedDir = join(root, "processed");
    mkdirSync(distDir, { recursive: true });
    mkdirSync(processedDir, { recursive: true });

    const sourcePath = join(distDir, "pubm-linux-x64");
    const transformedPath = join(processedDir, "pubm-linux-x64.transformed");
    writeFileSync(sourcePath, "source binary content");
    writeFileSync(transformedPath, "transformed binary content");

    const [group] = normalizeConfig(
      [
        {
          files: [
            {
              path: "dist/pubm-{platform}",
              compress: false,
              name: "{filename}-{platform}.bin",
            },
          ],
        },
      ],
      undefined,
    );
    const resolved = resolveAssets(group, undefined, root);
    const ledger: {
      kind: string;
      target: string;
      detail?: Record<string, unknown>;
    }[] = [
      {
        kind: "asset.resolve",
        target: toPosix(relative(root, resolved[0].filePath)),
        detail: {
          platform: resolved[0].platform.raw,
          compress: resolved[0].config.compress,
        },
      },
    ];
    const ctx = makeCtx({ cwd: root });

    const runner = new PluginRunner([
      {
        name: "contract-assets-plugin",
        hooks: {
          resolveAssets: (assets, receivedCtx) => {
            expect(receivedCtx).toBe(ctx);
            ledger.push({
              kind: "hook.resolveAssets",
              target: assets.map((asset) => basename(asset.filePath)).join(","),
            });
            return assets;
          },
          transformAsset: (asset, receivedCtx): TransformedAsset => {
            expect(receivedCtx).toBe(ctx);
            ledger.push({
              kind: "hook.transformAsset",
              target: basename(asset.filePath),
              detail: { next: basename(transformedPath) },
            });
            return {
              ...asset,
              filePath: transformedPath,
            };
          },
          compressAsset: (asset, receivedCtx): CompressedAsset => {
            expect(receivedCtx).toBe(ctx);
            ledger.push({
              kind: "hook.compressAsset",
              target: basename(asset.filePath),
              detail: { compressFormat: false },
            });
            return {
              filePath: asset.filePath,
              originalPath: asset.filePath,
              platform: asset.platform,
              compressFormat: false,
              config: asset.config,
            };
          },
          nameAsset: (asset, receivedCtx) => {
            expect(receivedCtx).toBe(ctx);
            ledger.push({
              kind: "hook.nameAsset",
              target: basename(asset.filePath),
            });
            return `contract-${asset.platform.raw}.bin`;
          },
          uploadAssets: async (assets, receivedCtx) => {
            expect(receivedCtx).toBe(ctx);
            ledger.push({
              kind: "hook.uploadAssets",
              target: assets.map((asset) => asset.name).join(","),
            });
            return assets.map((asset) => makeUploadedAsset(asset, "contract"));
          },
        },
      },
    ]);
    const hooks = runner.collectAssetHooks();

    const prepared = await runAssetPipeline(resolved, hooks, {
      name: "pubm",
      version: "1.2.3",
      tempDir,
      pubmContext: ctx,
    });
    const uploaded = await hooks.uploadAssets?.(prepared, ctx);

    expect(prepared).toHaveLength(1);
    expect(prepared[0]).toMatchObject({
      filePath: transformedPath,
      originalPath: transformedPath,
      name: "contract-linux-x64.bin",
      compressFormat: false,
      platform: { raw: "linux-x64", os: "linux", arch: "x64" },
    });
    expect(prepared[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(uploaded).toEqual([
      {
        ...prepared[0],
        target: "contract",
        url: "https://assets.example.test/contract-linux-x64.bin",
      },
    ]);
    expect(ledger).toEqual([
      {
        kind: "asset.resolve",
        target: "dist/pubm-linux-x64",
        detail: { platform: "linux-x64", compress: false },
      },
      {
        kind: "hook.resolveAssets",
        target: "pubm-linux-x64",
      },
      {
        kind: "hook.transformAsset",
        target: "pubm-linux-x64",
        detail: { next: "pubm-linux-x64.transformed" },
      },
      {
        kind: "hook.compressAsset",
        target: "pubm-linux-x64.transformed",
        detail: { compressFormat: false },
      },
      {
        kind: "hook.nameAsset",
        target: "pubm-linux-x64.transformed",
      },
      {
        kind: "hook.uploadAssets",
        target: "contract-linux-x64.bin",
      },
    ]);
  });
});
