import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("exec", () => {
  const originalBun = global.Bun;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.Bun = originalBun;
  });

  it("captures stdout and stderr, forwards stream chunks, and augments PATH", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: streamFromChunks(["hello ", "world"]),
      stderr: streamFromChunks(["warn\n"]),
      exited: Promise.resolve(0),
    });
    vi.stubGlobal("Bun", { spawn });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const { exec } = await import("../../../src/utils/exec.js");

    const result = await exec("pnpm", ["run", "build"], {
      onStdout: (chunk) => stdoutChunks.push(chunk),
      onStderr: (chunk) => stderrChunks.push(chunk),
      nodeOptions: {
        cwd: "/workspace/packages/core",
        env: { EXTRA_FLAG: "1" },
      },
    });

    expect(result).toEqual({
      stdout: "hello world",
      stderr: "warn\n",
      exitCode: 0,
    });
    expect(stdoutChunks).toEqual(["hello ", "world"]);
    expect(stderrChunks).toEqual(["warn\n"]);
    expect(spawn).toHaveBeenCalledWith(
      ["pnpm", "run", "build"],
      expect.objectContaining({
        cwd: "/workspace/packages/core",
        env: expect.objectContaining({
          EXTRA_FLAG: "1",
          PATH: expect.stringContaining(`${process.cwd()}/node_modules/.bin`),
        }),
      }),
    );
  });

  it("returns empty output when the child process exposes no pipes", async () => {
    vi.stubGlobal("Bun", {
      spawn: vi.fn().mockReturnValue({
        stdout: null,
        stderr: undefined,
        exited: Promise.resolve(0),
      }),
    });

    const { exec } = await import("../../../src/utils/exec.js");
    const result = await exec("true");

    expect(result).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  it("throws NonZeroExitError with captured output when throwOnError is enabled", async () => {
    vi.stubGlobal("Bun", {
      spawn: vi.fn().mockReturnValue({
        stdout: streamFromChunks(["out"]),
        stderr: streamFromChunks(["boom"]),
        exited: Promise.resolve(23),
      }),
    });

    const { exec, NonZeroExitError } = await import(
      "../../../src/utils/exec.js"
    );

    const error = await exec("false", [], { throwOnError: true }).catch(
      (reason) => reason,
    );

    expect(error).toBeInstanceOf(NonZeroExitError);
    expect(error).toMatchObject({
      message: expect.stringContaining('Command "false" exited with code 23'),
      output: {
        stdout: "out",
        stderr: "boom",
      },
    });
  });
});
