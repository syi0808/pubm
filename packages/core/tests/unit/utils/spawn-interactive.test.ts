import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("spawnInteractive", () => {
  const originalBun = global.Bun;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.Bun = originalBun;
    vi.unstubAllGlobals();
  });

  it("spawns an interactive child process with piped stdio", async () => {
    const child = {
      stdout: {} as ReadableStream<Uint8Array>,
      stderr: {} as ReadableStream<Uint8Array>,
      stdin: {
        write: vi.fn(),
        flush: vi.fn(),
      },
      exited: Promise.resolve(0),
    };
    const spawn = vi.fn().mockReturnValue(child);
    vi.stubGlobal("Bun", { spawn });

    const { spawnInteractive } = await import(
      "../../../src/utils/spawn-interactive.js"
    );
    const result = spawnInteractive(["npm", "login"]);

    expect(result).toBe(child);
    expect(spawn).toHaveBeenCalledWith(["npm", "login"], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });
  });
});
