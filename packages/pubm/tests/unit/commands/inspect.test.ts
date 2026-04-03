import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInspectPackages, mockConsoleError } = vi.hoisted(() => ({
  mockInspectPackages: vi.fn(),
  mockConsoleError: vi.fn(),
}));

vi.mock("@pubm/core", () => ({
  inspectPackages: mockInspectPackages,
  consoleError: mockConsoleError,
  t: (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return `${key}(${JSON.stringify(params)})`;
    }
    return key;
  },
}));

import { registerInspectCommand } from "../../../src/commands/inspect.js";

function makeParent(): Command {
  const parent = new Command();
  parent.exitOverride();
  return parent;
}

function makeConfig() {
  return {} as Parameters<
    typeof registerInspectCommand
  >[1] extends () => infer R
    ? R
    : never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerInspectCommand", () => {
  it("outputs JSON when --json flag is set", async () => {
    const result = {
      ecosystem: "node",
      workspace: { monorepo: false, type: "npm" },
      packages: [{ name: "pkg-a", version: "1.0.0", registries: ["npm"] }],
    };
    mockInspectPackages.mockReturnValue(result);

    const parent = makeParent();
    registerInspectCommand(parent, makeConfig);
    await parent.parseAsync(["node", "test", "inspect", "packages", "--json"]);

    expect(console.log).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
  });

  it("outputs human-readable format with ecosystem and workspace lines", async () => {
    const result = {
      ecosystem: "node",
      workspace: { monorepo: false, type: "npm" },
      packages: [
        { name: "pkg-a", version: "1.0.0", registries: ["npm", "jsr"] },
      ],
    };
    mockInspectPackages.mockReturnValue(result);

    const parent = makeParent();
    registerInspectCommand(parent, makeConfig);
    await parent.parseAsync(["node", "test", "inspect", "packages"]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("cmd.inspect.ecosystem"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Workspace:"),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("cmd.inspect.packageLine"),
    );
  });

  it("outputs monorepo workspace label when workspace is monorepo", async () => {
    const result = {
      ecosystem: "node",
      workspace: { monorepo: true, type: "turborepo" },
      packages: [{ name: "pkg-b", version: "2.0.0", registries: ["npm"] }],
    };
    mockInspectPackages.mockReturnValue(result);

    const parent = makeParent();
    registerInspectCommand(parent, makeConfig);
    await parent.parseAsync(["node", "test", "inspect", "packages"]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("cmd.inspect.monorepo"),
    );
  });

  it("prints no packages message when result has empty packages array", async () => {
    const result = {
      ecosystem: "node",
      workspace: { monorepo: false, type: "npm" },
      packages: [],
    };
    mockInspectPackages.mockReturnValue(result);

    const parent = makeParent();
    registerInspectCommand(parent, makeConfig);
    await parent.parseAsync(["node", "test", "inspect", "packages"]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("cmd.inspect.noPackages"),
    );
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("cmd.inspect.packagesHeader"),
    );
  });

  it("handles errors with consoleError and sets exitCode to 1", async () => {
    const error = new Error("inspect failed");
    mockInspectPackages.mockImplementation(() => {
      throw error;
    });

    const parent = makeParent();
    registerInspectCommand(parent, makeConfig);
    await parent.parseAsync(["node", "test", "inspect", "packages"]);

    expect(mockConsoleError).toHaveBeenCalledWith(error);
    expect(process.exitCode).toBe(1);

    // Reset exitCode to avoid leaking state into other tests
    process.exitCode = undefined;
  });
});
