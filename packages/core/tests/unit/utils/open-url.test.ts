import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("openUrl", () => {
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

  it("uses the native open command on macOS", async () => {
    const spawn = vi.fn();
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    const { openUrl } = await import("../../../src/utils/open-url.js");
    await openUrl("https://example.com");

    expect(spawn).toHaveBeenCalledWith(["open", "https://example.com"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  });

  it("uses cmd /c start on Windows", async () => {
    const spawn = vi.fn();
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    const { openUrl } = await import("../../../src/utils/open-url.js");
    await openUrl("https://example.com");

    expect(spawn).toHaveBeenCalledWith(
      ["cmd", "/c", "start", "https://example.com"],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );
  });

  it("falls back to xdg-open on Linux", async () => {
    const spawn = vi.fn();
    vi.stubGlobal("Bun", { spawn });
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    const { openUrl } = await import("../../../src/utils/open-url.js");
    await openUrl("https://example.com");

    expect(spawn).toHaveBeenCalledWith(["xdg-open", "https://example.com"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  });
});
