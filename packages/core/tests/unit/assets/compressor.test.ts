import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compressFile,
  isKnownArchive,
  resolveCompressFormat,
} from "../../../src/assets/compressor.js";

describe("isKnownArchive", () => {
  it("detects .tar.gz", () => expect(isKnownArchive("foo.tar.gz")).toBe(true));
  it("detects .zip", () => expect(isKnownArchive("foo.zip")).toBe(true));
  it("detects .dmg", () => expect(isKnownArchive("foo.dmg")).toBe(true));
  it("detects .msi", () => expect(isKnownArchive("foo.msi")).toBe(true));
  it("detects .deb", () => expect(isKnownArchive("foo.deb")).toBe(true));
  it("detects .wasm", () => expect(isKnownArchive("foo.wasm")).toBe(true));
  it("detects .exe", () => expect(isKnownArchive("foo.exe")).toBe(true));
  it("returns false for raw binary", () =>
    expect(isKnownArchive("pubm")).toBe(false));
  it("returns false for .ts", () =>
    expect(isKnownArchive("foo.ts")).toBe(false));
});

describe("resolveCompressFormat", () => {
  it("returns false for known archive file", () => {
    expect(resolveCompressFormat("foo.dmg", undefined, undefined)).toBe(false);
  });
  it("returns tar.gz for linux raw file (auto)", () => {
    expect(resolveCompressFormat("pubm", "linux", undefined)).toBe("tar.gz");
  });
  it("returns zip for windows raw file (auto)", () => {
    expect(resolveCompressFormat("pubm", "windows", undefined)).toBe("zip");
  });
  it("returns tar.gz for darwin raw file (auto)", () => {
    expect(resolveCompressFormat("pubm", "darwin", undefined)).toBe("tar.gz");
  });
  it("returns explicit format string", () => {
    expect(resolveCompressFormat("pubm", "linux", "zip")).toBe("zip");
  });
  it("returns false for explicit false", () => {
    expect(resolveCompressFormat("pubm", "linux", false)).toBe(false);
  });
  it("resolves OS-specific map", () => {
    const opt = { windows: "zip" as const, linux: "tar.xz" as const };
    expect(resolveCompressFormat("pubm", "linux", opt)).toBe("tar.xz");
    expect(resolveCompressFormat("pubm", "windows", opt)).toBe("zip");
  });
  it("falls back to auto when OS not in map", () => {
    const opt = { windows: "zip" as const };
    expect(resolveCompressFormat("pubm", "darwin", opt)).toBe("tar.gz");
  });
});

describe("compressFile", () => {
  const originalBun = (global as any).Bun;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Stub Bun.spawn to use Node's spawnSync so actual files are created
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
    (global as any).Bun = originalBun;
  });

  it("creates tar.gz archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compress-test-"));
    const srcFile = join(dir, "testbin");
    writeFileSync(srcFile, "binary content");
    const outDir = mkdtempSync(join(tmpdir(), "compress-out-"));
    const { compressFile: compressFileFresh } = await import(
      "../../../src/assets/compressor.js"
    );
    const result = await compressFileFresh(srcFile, outDir, "tar.gz");
    expect(result).toMatch(/\.tar\.gz$/);
    expect(existsSync(result)).toBe(true);
  });

  it.skipIf(process.platform === "win32")("creates zip archive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "compress-test-"));
    const srcFile = join(dir, "testbin");
    writeFileSync(srcFile, "binary content");
    const outDir = mkdtempSync(join(tmpdir(), "compress-out-"));
    const { compressFile: compressFileFresh } = await import(
      "../../../src/assets/compressor.js"
    );
    const result = await compressFileFresh(srcFile, outDir, "zip");
    expect(result).toMatch(/\.zip$/);
    expect(existsSync(result)).toBe(true);
  });
});

describe("compressFile Windows paths", () => {
  const mockExec = vi.hoisted(() => vi.fn());

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("../../../src/utils/exec.js", () => ({ exec: mockExec }));
    mockExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function importWinCompressor() {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const mod = await import("../../../src/assets/compressor.js");
      return mod.compressFile;
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  }

  it("uses powershell Compress-Archive for zip on Windows", async () => {
    const compress = await importWinCompressor();
    await compress("/tmp/bin/app", "/tmp/out", "zip");

    expect(mockExec).toHaveBeenCalledWith(
      "powershell",
      expect.arrayContaining(["-NoProfile", "-Command"]),
      expect.objectContaining({ throwOnError: true }),
    );
    const cmd = mockExec.mock.calls[0][1][2] as string;
    expect(cmd).toContain("Compress-Archive");
  });

  it("uses two-step tar + xz for tar.xz on Windows", async () => {
    const compress = await importWinCompressor();
    await compress("/tmp/bin/app", "/tmp/out", "tar.xz");

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec.mock.calls[0][0]).toBe("tar");
    expect(mockExec.mock.calls[0][1]).toContain("-cf");
    expect(mockExec.mock.calls[1][0]).toBe("xz");
  });

  it("uses two-step tar + zstd for tar.zst on Windows", async () => {
    const compress = await importWinCompressor();
    await compress("/tmp/bin/app", "/tmp/out", "tar.zst");

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(mockExec.mock.calls[0][0]).toBe("tar");
    expect(mockExec.mock.calls[0][1]).toContain("-cf");
    expect(mockExec.mock.calls[1][0]).toBe("zstd");
    expect(mockExec.mock.calls[1][1]).toContain("-o");
  });
});
