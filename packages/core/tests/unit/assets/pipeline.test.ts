import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAssetPipeline } from "../../../src/assets/pipeline.js";
import type {
  AssetPipelineHooks,
  ResolvedAsset,
} from "../../../src/assets/types.js";

function createTempBinary(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
  const file = join(dir, name);
  writeFileSync(file, "fake binary content");
  return file;
}

describe("runAssetPipeline", () => {
  it("runs with no hooks — compress:false uses defaults", async () => {
    const filePath = createTempBinary("pubm");
    const resolved: ResolvedAsset[] = [
      {
        filePath,
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
        config: {
          path: "test",
          compress: false,
          name: "{filename}-{platform}",
        },
      },
    ];

    const result = await runAssetPipeline(
      resolved,
      {},
      {
        name: "pubm",
        version: "0.4.0",
        tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")),
      },
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("pubm-darwin-arm64");
    expect(result[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result[0].compressFormat).toBe(false);
  });

  it("calls resolveAssets hook to filter", async () => {
    const filePath = createTempBinary("pubm");
    const resolved: ResolvedAsset[] = [
      {
        filePath,
        platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
        config: { path: "test", compress: false, name: "{filename}" },
      },
    ];

    const resolveHook = vi.fn(() => []);

    const result = await runAssetPipeline(
      resolved,
      { resolveAssets: resolveHook },
      {
        name: "test",
        version: "1.0.0",
        tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")),
      },
    );

    expect(resolveHook).toHaveBeenCalledOnce();
    expect(result).toHaveLength(0);
  });

  it("calls nameAsset hook", async () => {
    const filePath = createTempBinary("pubm");
    const resolved: ResolvedAsset[] = [
      {
        filePath,
        platform: { raw: "linux-x64", os: "linux", arch: "x64" },
        config: { path: "test", compress: false, name: "{filename}" },
      },
    ];

    const result = await runAssetPipeline(
      resolved,
      { nameAsset: () => "custom-name.bin" },
      {
        name: "test",
        version: "1.0.0",
        tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")),
      },
    );

    expect(result[0].name).toBe("custom-name.bin");
  });

  it("calls transformAsset hook that returns array", async () => {
    const filePath = createTempBinary("pubm");
    const resolved: ResolvedAsset[] = [
      {
        filePath,
        platform: { raw: "linux-x64", os: "linux", arch: "x64" },
        config: { path: "test", compress: false, name: "{filename}" },
      },
    ];

    const transformHook = vi.fn((asset) => [
      asset,
      { ...asset, filePath: createTempBinary("extra") },
    ]);

    const result = await runAssetPipeline(
      resolved,
      { transformAsset: transformHook },
      {
        name: "test",
        version: "1.0.0",
        tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")),
      },
    );

    expect(transformHook).toHaveBeenCalledOnce();
    expect(result).toHaveLength(2);
  });

  describe("with Bun stub (compression)", () => {
    beforeEach(() => {
      vi.stubGlobal("Bun", {
        spawn: (args: string[], opts: any) => {
          const [cmd, ...cmdArgs] = args;
          const result = spawnSync(cmd, cmdArgs, {
            cwd: opts?.cwd,
            env: { ...process.env, ...opts?.env },
          });
          const encoder = new TextEncoder();
          const stdout = new ReadableStream<Uint8Array>({
            start(controller) {
              if (result.stdout)
                controller.enqueue(encoder.encode(result.stdout.toString()));
              controller.close();
            },
          });
          const stderr = new ReadableStream<Uint8Array>({
            start(controller) {
              if (result.stderr)
                controller.enqueue(encoder.encode(result.stderr.toString()));
              controller.close();
            },
          });
          return {
            stdout,
            stderr,
            exited: Promise.resolve(result.status ?? 1),
          };
        },
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("runs with tar.gz compression", async () => {
      const filePath = createTempBinary("pubm");
      const resolved: ResolvedAsset[] = [
        {
          filePath,
          platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
          config: {
            path: "test",
            compress: "tar.gz",
            name: "{filename}-{platform}",
          },
        },
      ];

      const result = await runAssetPipeline(
        resolved,
        {},
        {
          name: "pubm",
          version: "0.4.0",
          tempDir: mkdtempSync(join(tmpdir(), "pipeline-temp-")),
        },
      );

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("pubm-darwin-arm64.tar.gz");
      expect(result[0].compressFormat).toBe("tar.gz");
    });
  });
});
