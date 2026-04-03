import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetStatus, mockUiInfo } = vi.hoisted(() => ({
  mockGetStatus: vi.fn(),
  mockUiInfo: vi.fn(),
}));

vi.mock("@pubm/core", () => ({
  getStatus: mockGetStatus,
  t: (key: string) => key,
  ui: {
    info: mockUiInfo,
  },
}));

import { registerStatusCommand } from "../../../src/commands/status.js";

function makeParent(): Command {
  const parent = new Command();
  parent.exitOverride();
  return parent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerStatusCommand", () => {
  it("prints noPending when no changesets exist and --since is not set", async () => {
    mockGetStatus.mockReturnValue({
      hasChangesets: false,
      packages: new Map(),
    });

    const parent = makeParent();
    registerStatusCommand(parent);
    await parent.parseAsync(["node", "test", "status"]);

    expect(mockUiInfo).toHaveBeenCalledWith("cmd.status.noPending");
    expect(mockUiInfo).not.toHaveBeenCalledWith("cmd.status.noChangesets");
  });

  it("prints noChangesets and exits with 1 when --since is set and no changesets exist", async () => {
    mockGetStatus.mockReturnValue({
      hasChangesets: false,
      packages: new Map(),
    });

    class ProcessExitError extends Error {
      constructor(public readonly code: number | undefined) {
        super(`process.exit(${code})`);
        this.name = "ProcessExitError";
      }
    }

    const mockExit = vi
      .spyOn(process, "exit")
      .mockImplementation((code?: number) => {
        throw new ProcessExitError(code);
      });

    const parent = makeParent();
    registerStatusCommand(parent);

    await expect(
      parent.parseAsync(["node", "test", "status", "--since", "v1.0.0"]),
    ).rejects.toThrow(ProcessExitError);

    expect(mockUiInfo).toHaveBeenCalledWith("cmd.status.noChangesets");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockUiInfo).not.toHaveBeenCalledWith("cmd.status.noPending");

    mockExit.mockRestore();
  });

  it("prints pending packages when changesets exist", async () => {
    mockGetStatus.mockReturnValue({
      hasChangesets: true,
      packages: new Map([
        [
          "pkg-a",
          {
            bumpType: "minor",
            changesetCount: 2,
            summaries: ["feat: add thing", "feat: another"],
          },
        ],
      ]),
    });

    const parent = makeParent();
    registerStatusCommand(parent);
    await parent.parseAsync(["node", "test", "status"]);

    expect(mockUiInfo).toHaveBeenCalledWith("cmd.status.pending");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("cmd.status.packageLine"),
    );
    // summaries should NOT be printed without --verbose
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("feat: add thing"),
    );
  });

  it("prints summaries when --verbose is set", async () => {
    mockGetStatus.mockReturnValue({
      hasChangesets: true,
      packages: new Map([
        [
          "pkg-b",
          {
            bumpType: "patch",
            changesetCount: 1,
            summaries: ["fix: correct typo"],
          },
        ],
      ]),
    });

    const parent = makeParent();
    registerStatusCommand(parent);
    await parent.parseAsync(["node", "test", "status", "--verbose"]);

    expect(mockUiInfo).toHaveBeenCalledWith("cmd.status.pending");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("cmd.status.packageLine"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("fix: correct typo"),
    );
  });
});
