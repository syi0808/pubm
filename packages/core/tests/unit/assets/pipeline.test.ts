import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAssetPipeline } from "../../../src/assets/pipeline.js";
import type { ResolvedAsset } from "../../../src/assets/types.js";

type BunSpawnOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
};

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
    const originalBun = globalThis.Bun;

    beforeEach(() => {
      globalThis.Bun = {
        spawn: (args: string[], opts?: BunSpawnOptions) => {
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
      } as typeof Bun;
    });

    afterEach(() => {
      globalThis.Bun = originalBun;
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

    it("produces distinct archives for multiple platforms with same binary name", async () => {
      const darwinDir = mkdtempSync(join(tmpdir(), "darwin-"));
      const linuxDir = mkdtempSync(join(tmpdir(), "linux-"));
      const darwinBin = join(darwinDir, "pubm");
      const linuxBin = join(linuxDir, "pubm");
      writeFileSync(darwinBin, "darwin-arm64-binary-content");
      writeFileSync(linuxBin, "linux-x64-binary-content");

      const resolved: ResolvedAsset[] = [
        {
          filePath: darwinBin,
          platform: { raw: "darwin-arm64", os: "darwin", arch: "arm64" },
          config: {
            path: "test",
            compress: "tar.gz",
            name: "{filename}-{platform}",
          },
        },
        {
          filePath: linuxBin,
          platform: { raw: "linux-x64", os: "linux", arch: "x64" },
          config: {
            path: "test",
            compress: "tar.gz",
            name: "{filename}-{platform}",
          },
        },
      ];

      const tempDir = mkdtempSync(join(tmpdir(), "pipeline-temp-"));
      const result = await runAssetPipeline(
        resolved,
        {},
        { name: "pubm", version: "0.4.0", tempDir },
      );

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("pubm-darwin-arm64.tar.gz");
      expect(result[1].name).toBe("pubm-linux-x64.tar.gz");

      // Archives must point to different files with different content
      const content0 = readFileSync(result[0].filePath);
      const content1 = readFileSync(result[1].filePath);
      expect(Buffer.compare(content0, content1)).not.toBe(0);
      expect(result[0].sha256).not.toBe(result[1].sha256);
    });
  });
});
