import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockWriteChangeset,
  mockUiSuccess,
  mockUiWarn,
  mockCreateKeyResolver,
  mockEnquirerPrompt,
} = vi.hoisted(() => ({
  mockWriteChangeset: vi.fn().mockReturnValue("/path/to/changeset.md"),
  mockUiSuccess: vi.fn(),
  mockUiWarn: vi.fn(),
  mockCreateKeyResolver: vi.fn(),
  mockEnquirerPrompt: vi.fn(),
}));

vi.mock("@pubm/core", () => ({
  writeChangeset: mockWriteChangeset,
  createKeyResolver: mockCreateKeyResolver,
  ui: {
    success: mockUiSuccess,
    warn: mockUiWarn,
  },
  t: (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return `${key}(${JSON.stringify(params)})`;
    }
    return key;
  },
}));

vi.mock("enquirer", () => ({
  default: { prompt: mockEnquirerPrompt },
}));

import { registerAddCommand } from "../../../src/commands/add.js";

function makeParent(): Command {
  const parent = new Command();
  parent.exitOverride();
  return parent;
}

function makeConfig(
  packages: { name: string; path: string; version: string }[] = [],
  versioning: "independent" | "fixed" = "independent",
) {
  return {
    packages,
    versioning,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteChangeset.mockReturnValue("/path/to/changeset.md");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerAddCommand", () => {
  it("creates empty changeset with --empty flag", async () => {
    const parent = makeParent();
    registerAddCommand(parent, () => makeConfig());
    await parent.parseAsync(["node", "test", "add", "--empty"]);

    expect(mockWriteChangeset).toHaveBeenCalledWith([], "");
    expect(mockUiSuccess).toHaveBeenCalledWith(expect.any(String));
    expect(mockEnquirerPrompt).not.toHaveBeenCalled();
  });

  it("creates changeset from CLI options", async () => {
    const keyResolver = vi.fn((input: string) => `resolved/${input}`);
    mockCreateKeyResolver.mockReturnValue(keyResolver);

    const parent = makeParent();
    registerAddCommand(parent, () =>
      makeConfig([{ name: "pkg-a", path: "packages/a", version: "1.0.0" }]),
    );
    await parent.parseAsync([
      "node",
      "test",
      "add",
      "--packages",
      "packages/a",
      "--bump",
      "minor",
      "--message",
      "feat",
    ]);

    expect(mockWriteChangeset).toHaveBeenCalledWith(
      [{ path: "resolved/packages/a", type: "minor" }],
      "feat",
    );
    expect(mockUiSuccess).toHaveBeenCalledWith(expect.any(String));
    expect(mockEnquirerPrompt).not.toHaveBeenCalled();
  });

  it("throws on invalid bump type from CLI options", async () => {
    const keyResolver = vi.fn((input: string) => input);
    mockCreateKeyResolver.mockReturnValue(keyResolver);

    const parent = makeParent();
    registerAddCommand(parent, () =>
      makeConfig([{ name: "pkg-a", path: "packages/a", version: "1.0.0" }]),
    );

    await expect(
      parent.parseAsync([
        "node",
        "test",
        "add",
        "--packages",
        "a",
        "--bump",
        "invalid",
        "--message",
        "msg",
      ]),
    ).rejects.toThrow();

    expect(mockWriteChangeset).not.toHaveBeenCalled();
  });

  it("auto-selects single package in interactive mode", async () => {
    // For single package: bump prompt then summary prompt
    mockEnquirerPrompt
      .mockResolvedValueOnce({ bump: "patch" })
      .mockResolvedValueOnce({ summary: "fix: a bug" });

    const parent = makeParent();
    registerAddCommand(parent, () =>
      makeConfig([{ name: "pkg-a", path: "packages/a", version: "1.2.3" }]),
    );
    await parent.parseAsync(["node", "test", "add"]);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("pkg-a"));
    expect(mockWriteChangeset).toHaveBeenCalledWith(
      [{ path: "packages/a", type: "patch" }],
      "fix: a bug",
      expect.any(String),
    );
    expect(mockUiSuccess).toHaveBeenCalledWith(expect.any(String));
  });

  it("warns when no packages are selected in interactive mode", async () => {
    // For multi-package: first prompt returns empty selection
    mockEnquirerPrompt.mockResolvedValueOnce({ packages: [] });

    const parent = makeParent();
    registerAddCommand(parent, () =>
      makeConfig([
        { name: "pkg-a", path: "packages/a", version: "1.0.0" },
        { name: "pkg-b", path: "packages/b", version: "2.0.0" },
      ]),
    );
    await parent.parseAsync(["node", "test", "add"]);

    expect(mockUiWarn).toHaveBeenCalledWith(expect.any(String));
    expect(mockWriteChangeset).not.toHaveBeenCalled();
  });

  it("handles multi-package interactive flow", async () => {
    // For multi-package: package selection, then bump per package, then summary
    mockEnquirerPrompt
      .mockResolvedValueOnce({ packages: ["pkg-a", "pkg-b"] })
      .mockResolvedValueOnce({ bump: "minor" })
      .mockResolvedValueOnce({ bump: "patch" })
      .mockResolvedValueOnce({ summary: "multi-package update" });

    const parent = makeParent();
    registerAddCommand(parent, () =>
      makeConfig([
        { name: "pkg-a", path: "packages/a", version: "1.0.0" },
        { name: "pkg-b", path: "packages/b", version: "2.0.0" },
      ]),
    );
    await parent.parseAsync(["node", "test", "add"]);

    expect(mockWriteChangeset).toHaveBeenCalledWith(
      [
        { path: "packages/a", type: "minor" },
        { path: "packages/b", type: "patch" },
      ],
      "multi-package update",
      expect.any(String),
    );
    expect(mockUiSuccess).toHaveBeenCalledWith(expect.any(String));
  });

  it("pre-selects all packages in fixed mode interactive flow", async () => {
    mockEnquirerPrompt
      .mockResolvedValueOnce({ packages: ["pkg-a", "pkg-b"] })
      .mockResolvedValueOnce({ bump: "minor" })
      .mockResolvedValueOnce({ summary: "fixed bump" });

    const parent = makeParent();
    registerAddCommand(parent, () =>
      makeConfig(
        [
          { name: "pkg-a", path: "packages/a", version: "1.0.0" },
          { name: "pkg-b", path: "packages/b", version: "2.0.0" },
        ],
        "fixed",
      ),
    );
    await parent.parseAsync(["node", "test", "add"]);

    const firstCall = mockEnquirerPrompt.mock.calls[0][0];
    expect(firstCall.type).toBe("multiselect");
    expect(firstCall.initial).toEqual(["pkg-a", "pkg-b"]);

    expect(mockEnquirerPrompt).toHaveBeenCalledTimes(3);

    expect(mockWriteChangeset).toHaveBeenCalledWith(
      [
        { path: "packages/a", type: "minor" },
        { path: "packages/b", type: "minor" },
      ],
      "fixed bump",
      expect.any(String),
    );
  });

  it("passes initial with all package names in fixed mode (regression)", async () => {
    mockEnquirerPrompt
      .mockResolvedValueOnce({ packages: ["pkg-a", "pkg-b", "pkg-c"] })
      .mockResolvedValueOnce({ bump: "patch" })
      .mockResolvedValueOnce({ summary: "regression test" });

    const packages = [
      { name: "pkg-a", path: "packages/a", version: "1.0.0" },
      { name: "pkg-b", path: "packages/b", version: "2.0.0" },
      { name: "pkg-c", path: "packages/c", version: "3.0.0" },
    ];

    const parent = makeParent();
    registerAddCommand(parent, () => makeConfig(packages, "fixed"));
    await parent.parseAsync(["node", "test", "add"]);

    const firstCall = mockEnquirerPrompt.mock.calls[0][0];
    expect(firstCall.initial).toEqual(packages.map((pkg) => pkg.name));
    expect(firstCall.choices).not.toContainEqual(
      expect.objectContaining({ enabled: true }),
    );
  });

  it("prompts bump per-package in independent mode", async () => {
    mockEnquirerPrompt
      .mockResolvedValueOnce({ packages: ["pkg-a", "pkg-b"] })
      .mockResolvedValueOnce({ bump: "minor" })
      .mockResolvedValueOnce({ bump: "patch" })
      .mockResolvedValueOnce({ summary: "independent bump" });

    const parent = makeParent();
    registerAddCommand(parent, () =>
      makeConfig(
        [
          { name: "pkg-a", path: "packages/a", version: "1.0.0" },
          { name: "pkg-b", path: "packages/b", version: "2.0.0" },
        ],
        "independent",
      ),
    );
    await parent.parseAsync(["node", "test", "add"]);

    const firstCall = mockEnquirerPrompt.mock.calls[0][0];
    expect(firstCall.type).toBe("multiselect");
    expect(firstCall.initial).toBeUndefined();

    expect(mockEnquirerPrompt).toHaveBeenCalledTimes(4);
  });
});
