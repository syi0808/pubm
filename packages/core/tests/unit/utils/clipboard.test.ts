import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("copyToClipboard", () => {
  const originalPlatform = process.platform;
  const originalBun = global.Bun;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    global.Bun = originalBun;
    vi.unstubAllGlobals();
  });

  it("uses pbcopy on macOS", async () => {
    const mockStdin = { write: vi.fn(), end: vi.fn() };
    const mockProc = { stdin: mockStdin, exited: Promise.resolve(0) };
    const spawn = vi.fn().mockReturnValue(mockProc);
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    const { copyToClipboard } = await import("../../../src/utils/clipboard.js");
    const result = await copyToClipboard("test text");

    expect(spawn).toHaveBeenCalledWith(
      ["pbcopy"],
      expect.objectContaining({ stdin: "pipe" }),
    );
    expect(mockStdin.write).toHaveBeenCalledWith("test text");
    expect(mockStdin.end).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("uses clip on Windows", async () => {
    const mockStdin = { write: vi.fn(), end: vi.fn() };
    const mockProc = { stdin: mockStdin, exited: Promise.resolve(0) };
    const spawn = vi.fn().mockReturnValue(mockProc);
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    const { copyToClipboard } = await import("../../../src/utils/clipboard.js");
    const result = await copyToClipboard("test text");

    expect(spawn).toHaveBeenCalledWith(
      ["clip"],
      expect.objectContaining({ stdin: "pipe" }),
    );
    expect(result).toBe(true);
  });

  it("tries xclip then wl-copy on Linux", async () => {
    const mockStdin = { write: vi.fn(), end: vi.fn() };
    const failProc = { stdin: mockStdin, exited: Promise.resolve(1) };
    const successProc = { stdin: mockStdin, exited: Promise.resolve(0) };
    const spawn = vi
      .fn()
      .mockReturnValueOnce(failProc)
      .mockReturnValueOnce(successProc);
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    const { copyToClipboard } = await import("../../../src/utils/clipboard.js");
    const result = await copyToClipboard("test text");

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      ["xclip", "-selection", "clipboard"],
      expect.any(Object),
    );
    expect(spawn).toHaveBeenNthCalledWith(2, ["wl-copy"], expect.any(Object));
    expect(result).toBe(true);
  });

  it("returns false when all clipboard tools fail", async () => {
    const mockStdin = { write: vi.fn(), end: vi.fn() };
    const failProc = { stdin: mockStdin, exited: Promise.resolve(1) };
    const spawn = vi.fn().mockReturnValue(failProc);
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    const { copyToClipboard } = await import("../../../src/utils/clipboard.js");
    const result = await copyToClipboard("test text");

    expect(result).toBe(false);
  });

  it("returns false when spawn throws", async () => {
    const spawn = vi.fn().mockImplementation(() => {
      throw new Error("command not found");
    });
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    const { copyToClipboard } = await import("../../../src/utils/clipboard.js");
    const result = await copyToClipboard("test text");

    expect(result).toBe(false);
  });
});
