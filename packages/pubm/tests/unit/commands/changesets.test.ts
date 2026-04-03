import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRegisterAddCommand,
  mockRegisterChangelogCommand,
  mockRegisterStatusCommand,
  mockRegisterVersionCommand,
} = vi.hoisted(() => ({
  mockRegisterAddCommand: vi.fn(),
  mockRegisterChangelogCommand: vi.fn(),
  mockRegisterStatusCommand: vi.fn(),
  mockRegisterVersionCommand: vi.fn(),
}));

vi.mock("@pubm/core", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../src/commands/add.js", () => ({
  registerAddCommand: mockRegisterAddCommand,
}));

vi.mock("../../../src/commands/changelog.js", () => ({
  registerChangelogCommand: mockRegisterChangelogCommand,
}));

vi.mock("../../../src/commands/status.js", () => ({
  registerStatusCommand: mockRegisterStatusCommand,
}));

vi.mock("../../../src/commands/version-cmd.js", () => ({
  registerVersionCommand: mockRegisterVersionCommand,
}));

const { registerChangesetsCommand } = await import(
  "../../../src/commands/changesets.js"
);

describe("registerChangesetsCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all sub-commands", () => {
    const program = new Command();
    const getConfig = vi.fn();

    registerChangesetsCommand(program, getConfig);

    expect(mockRegisterAddCommand).toHaveBeenCalledTimes(1);
    expect(mockRegisterChangelogCommand).toHaveBeenCalledTimes(1);
    expect(mockRegisterStatusCommand).toHaveBeenCalledTimes(1);
    expect(mockRegisterVersionCommand).toHaveBeenCalledTimes(1);
  });

  it("passes getConfig to sub-commands that need it", () => {
    const program = new Command();
    const getConfig = vi.fn();

    registerChangesetsCommand(program, getConfig);

    expect(mockRegisterAddCommand).toHaveBeenCalledWith(
      expect.any(Command),
      getConfig,
    );
    expect(mockRegisterVersionCommand).toHaveBeenCalledWith(
      expect.any(Command),
      getConfig,
    );
  });
});
