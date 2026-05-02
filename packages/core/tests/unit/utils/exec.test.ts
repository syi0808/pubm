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

  it("returns result with non-zero exitCode when throwOnError is not set", async () => {
    vi.stubGlobal("Bun", {
      spawn: vi.fn().mockReturnValue({
        stdout: streamFromChunks(["partial"]),
        stderr: streamFromChunks(["error output"]),
        exited: Promise.resolve(1),
      }),
    });

    const { exec } = await import("../../../src/utils/exec.js");

    const result = await exec("failing-cmd", ["arg1"]);

    expect(result).toEqual({
      stdout: "partial",
      stderr: "error output",
      exitCode: 1,
    });
  });

  it("uses default args and options when not provided", async () => {
    const spawn = vi.fn().mockReturnValue({
      stdout: streamFromChunks(["ok"]),
      stderr: streamFromChunks([]),
      exited: Promise.resolve(0),
    });
    vi.stubGlobal("Bun", { spawn });

    const { exec } = await import("../../../src/utils/exec.js");

    const result = await exec("echo");

    expect(result.exitCode).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      ["echo"],
      expect.objectContaining({
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
  });

  it("falls back to an empty PATH suffix when PATH is unset", async () => {
    const originalPath = process.env.PATH;
    const spawn = vi.fn().mockReturnValue({
      stdout: streamFromChunks(["ok"]),
      stderr: streamFromChunks([]),
      exited: Promise.resolve(0),
    });
    vi.stubGlobal("Bun", { spawn });
    delete process.env.PATH;

    try {
      const { exec } = await import("../../../src/utils/exec.js");

      await exec("echo");
    } finally {
      process.env.PATH = originalPath;
    }

    expect(spawn).toHaveBeenCalledWith(
      ["echo"],
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringMatching(/node_modules\/\.bin[:;]$/),
        }),
      }),
    );
  });

  it("includes trailing decoder output when stream ends with a partial chunk", async () => {
    // TextDecoder.decode() with no args after streaming may produce trailing
    // bytes. We simulate this by creating a stream whose final chunk encodes
    // a multi-byte character split across two enqueue calls, so the trailing
    // decode produces output on lines 60-61.
    const encoder = new TextEncoder();
    const bytes = encoder.encode("hello\u00e9"); // é is 2 bytes in UTF-8
    // Split so the last byte is delivered alone — the decoder in stream mode
    // will buffer it, and the trailing decode() call will flush it.
    const firstPart = bytes.slice(0, bytes.length - 1);
    const lastPart = bytes.slice(bytes.length - 1);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(firstPart);
        controller.enqueue(lastPart);
        controller.close();
      },
    });

    vi.stubGlobal("Bun", {
      spawn: vi.fn().mockReturnValue({
        stdout: stream,
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      }),
    });

    const { exec } = await import("../../../src/utils/exec.js");
    const result = await exec("test-cmd");

    expect(result.stdout).toBe("hello\u00e9");
    expect(result.exitCode).toBe(0);
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

  it("falls back to node child_process when Bun is unavailable", async () => {
    vi.stubGlobal("Bun", undefined);
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const { exec } = await import("../../../src/utils/exec.js");

    const result = await exec(
      process.execPath,
      [
        "-e",
        "process.stdout.write('node out'); process.stderr.write('node err')",
      ],
      {
        onStdout: (chunk) => stdoutChunks.push(chunk),
        onStderr: (chunk) => stderrChunks.push(chunk),
      },
    );

    expect(result).toEqual({
      stdout: "node out",
      stderr: "node err",
      exitCode: 0,
    });
    expect(stdoutChunks).toEqual(["node out"]);
    expect(stderrChunks).toEqual(["node err"]);
  });
});
