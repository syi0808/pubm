import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockConsoleError,
  mockCreateContext,
  mockResolveOptions,
  mockRunSnapshotPipeline,
} = vi.hoisted(() => ({
  mockConsoleError: vi.fn(),
  mockCreateContext: vi.fn().mockReturnValue({}),
  mockResolveOptions: vi.fn().mockReturnValue({}),
  mockRunSnapshotPipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@pubm/core", () => ({
  consoleError: mockConsoleError,
  createContext: mockCreateContext,
  resolveOptions: mockResolveOptions,
  runSnapshotPipeline: mockRunSnapshotPipeline,
  t: (key: string) => key,
}));

import { registerSnapshotCommand } from "../../../src/commands/snapshot.js";

const mockConfig = {} as never;
const getConfig = () => mockConfig;

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateContext.mockReturnValue({});
  mockResolveOptions.mockReturnValue({});
  mockRunSnapshotPipeline.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("registerSnapshotCommand", () => {
  it("runs snapshot pipeline with default options", async () => {
    const program = makeProgram();
    registerSnapshotCommand(program, getConfig);
    await program.parseAsync(["node", "test", "snapshot"]);

    expect(mockResolveOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "local",
        skipTests: false,
        skipBuild: false,
      }),
    );
    expect(mockRunSnapshotPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tag: "snapshot",
        filter: undefined,
      }),
    );
  });

  it("passes custom tag argument", async () => {
    const program = makeProgram();
    registerSnapshotCommand(program, getConfig);
    await program.parseAsync(["node", "test", "snapshot", "beta"]);

    expect(mockRunSnapshotPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tag: "beta",
      }),
    );
  });

  it("passes filter options", async () => {
    const program = makeProgram();
    registerSnapshotCommand(program, getConfig);
    await program.parseAsync([
      "node",
      "test",
      "snapshot",
      "-f",
      "pkg-a",
      "-f",
      "pkg-b",
    ]);

    expect(mockRunSnapshotPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filter: ["pkg-a", "pkg-b"],
      }),
    );
  });

  it("passes --dry-run flag", async () => {
    const program = makeProgram();
    registerSnapshotCommand(program, getConfig);
    await program.parseAsync(["node", "test", "snapshot", "--dry-run"]);

    expect(mockRunSnapshotPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dryRun: true,
      }),
    );
  });

  it("passes --no-tests and --no-build", async () => {
    const program = makeProgram();
    registerSnapshotCommand(program, getConfig);
    await program.parseAsync([
      "node",
      "test",
      "snapshot",
      "--no-tests",
      "--no-build",
    ]);

    expect(mockRunSnapshotPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skipTests: true,
        skipBuild: true,
      }),
    );
  });

  it("handles errors with consoleError and exitCode", async () => {
    const error = new Error("pipeline failed");
    mockRunSnapshotPipeline.mockRejectedValue(error);

    const program = makeProgram();
    registerSnapshotCommand(program, getConfig);
    await program.parseAsync(["node", "test", "snapshot"]);

    expect(mockConsoleError).toHaveBeenCalledWith(error);
    expect(process.exitCode).toBe(1);
  });
});
