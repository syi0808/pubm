import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  capturedAction,
  capturedHelpCallback,
  mockCli,
  mockIsCI,
  mockConsoleError,
  mockGitInstance,
  mockPubm,
  mockRequiredMissingInformationTasks,
  mockNotifyNewVersion,
  optionCallCount,
} = vi.hoisted(() => {
  const ref = {
    capturedAction: { value: undefined as Function | undefined },
    capturedHelpCallback: { value: undefined as Function | undefined },
  };

  // Track calls that happen during module initialization and survive clearAllMocks
  const optionCallCount = { value: 0 };

  const mockCommand: Record<string, ReturnType<typeof vi.fn>> = {
    option: vi.fn((..._args: unknown[]) => {
      optionCallCount.value++;
      return mockCommand;
    }),
    action: vi.fn((fn: Function) => {
      ref.capturedAction.value = fn;
      return mockCommand;
    }),
  };

  const mockCli = {
    option: vi.fn((..._args: unknown[]) => {
      optionCallCount.value++;
      return mockCli;
    }),
    command: vi.fn(() => mockCommand),
    help: vi.fn((fn: Function) => {
      ref.capturedHelpCallback.value = fn;
    }),
    version: vi.fn(),
    parse: vi.fn(),
  };

  return {
    capturedAction: ref.capturedAction,
    capturedHelpCallback: ref.capturedHelpCallback,
    mockCli,
    mockIsCI: { isCI: false },
    mockConsoleError: vi.fn(),
    mockGitInstance: { latestTag: vi.fn() },
    mockPubm: vi.fn(),
    mockRequiredMissingInformationTasks: vi.fn(() => ({ run: vi.fn() })),
    mockNotifyNewVersion: vi.fn(),
    optionCallCount,
  };
});

vi.mock("cac", () => ({
  default: vi.fn(() => mockCli),
}));

vi.mock("std-env", () => mockIsCI);

vi.mock("../../src/error.js", () => ({
  consoleError: mockConsoleError,
}));

vi.mock("../../src/git.js", () => ({
  Git: vi.fn(() => mockGitInstance),
}));

vi.mock("../../src/index.js", () => ({
  pubm: mockPubm,
}));

vi.mock("../../src/tasks/required-missing-information.js", () => ({
  requiredMissingInformationTasks: mockRequiredMissingInformationTasks,
}));

vi.mock("../../src/utils/notify-new-version.js", () => ({
  notifyNewVersion: mockNotifyNewVersion,
}));

vi.mock("../../src/utils/package.js", () => ({
  version: vi.fn().mockResolvedValue("1.0.0"),
}));

vi.mock("../../src/commands/add.js", () => ({
  registerAddCommand: vi.fn(),
}));

vi.mock("../../src/commands/init.js", () => ({
  registerInitCommand: vi.fn(),
}));

vi.mock("../../src/commands/migrate.js", () => ({
  registerMigrateCommand: vi.fn(),
}));

vi.mock("../../src/commands/pre.js", () => ({
  registerPreCommand: vi.fn(),
}));

vi.mock("../../src/commands/snapshot.js", () => ({
  registerSnapshotCommand: vi.fn(),
}));

vi.mock("../../src/commands/status.js", () => ({
  registerStatusCommand: vi.fn(),
}));

vi.mock("../../src/commands/version-cmd.js", () => ({
  registerVersionCommand: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCI.isCI = false;
  vi.spyOn(console, "clear").mockImplementation(() => {});
});

// Import cli.ts - this triggers the IIFE which calls cli.version() and cli.parse()
// and registers the command action handler.
import "../../src/cli.js";

describe("cli setup", () => {
  // These tests verify state captured during module initialization.
  // Since vi.clearAllMocks() resets spy call counts, we use the persistent
  // ref objects and a manual counter instead.

  it("should register at least 13 options via cli.option()", () => {
    expect(optionCallCount.value).toBeGreaterThanOrEqual(13);
  });

  it("should capture the command action handler", () => {
    expect(capturedAction.value).toBeDefined();
    expect(typeof capturedAction.value).toBe("function");
  });

  it("should capture the help callback", () => {
    expect(capturedHelpCallback.value).toBeDefined();
    expect(typeof capturedHelpCallback.value).toBe("function");
  });
});

describe("resolveCliOptions (tested through CLI action)", () => {
  it("should map publish=false to skipPublish=true", async () => {
    await capturedAction.value!(undefined, {
      publish: false,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipPublish: true }),
    );
  });

  it("should map tests=false to skipTests=true", async () => {
    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: true,
      tests: false,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipTests: true }),
    );
  });

  it("should map build=false to skipBuild=true", async () => {
    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: false,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipBuild: true }),
    );
  });

  it("should map releaseDraft=false to skipReleaseDraft=true", async () => {
    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: false,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipReleaseDraft: true }),
    );
  });

  it("should map preCheck=false to skipPrerequisitesCheck=true", async () => {
    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: false,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipPrerequisitesCheck: true }),
    );
  });

  it("should map conditionCheck=false to skipConditionsCheck=true", async () => {
    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: false,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipConditionsCheck: true }),
    );
  });

  it("should split comma-separated registry string into array", async () => {
    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
      registry: "npm,jsr,https://custom.registry.com",
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({
        registries: ["npm", "jsr", "https://custom.registry.com"],
      }),
    );
  });

  it("should set registries to undefined when registry is not provided", async () => {
    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ registries: undefined }),
    );
  });
});

describe("CLI action handler - non-CI mode", () => {
  const defaultOptions = {
    publish: true,
    releaseDraft: true,
    tests: true,
    build: true,
    preCheck: true,
    conditionCheck: true,
    tag: "latest",
    publishOnly: false,
  };

  it("should call notifyNewVersion when not in CI", async () => {
    mockIsCI.isCI = false;

    await capturedAction.value!(undefined, { ...defaultOptions });

    expect(mockNotifyNewVersion).toHaveBeenCalledOnce();
  });

  it("should run requiredMissingInformationTasks when not in CI", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await capturedAction.value!(undefined, { ...defaultOptions });

    expect(mockRequiredMissingInformationTasks).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "latest" }),
    );
  });

  it("should call pubm with resolved options after interactive tasks", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });

    await capturedAction.value!("1.2.3", { ...defaultOptions });

    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ version: "1.2.3" }),
    );
  });

  it("should call console.clear at the start", async () => {
    const clearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

    await capturedAction.value!(undefined, { ...defaultOptions });

    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("CLI action handler - CI mode", () => {
  const defaultOptions = {
    publish: true,
    releaseDraft: true,
    tests: true,
    build: true,
    preCheck: true,
    conditionCheck: true,
    tag: "latest",
    publishOnly: false,
  };

  it("should get version from latest git tag when publishOnly is true", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");

    await capturedAction.value!(undefined, {
      ...defaultOptions,
      publishOnly: true,
    });

    expect(mockGitInstance.latestTag).toHaveBeenCalled();
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ version: "2.0.0" }),
    );
  });

  it("should throw when no latest tag exists in publishOnly mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue(null);

    await capturedAction.value!(undefined, {
      ...defaultOptions,
      publishOnly: true,
    });

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Cannot find the latest tag"),
      }),
    );
  });

  it("should throw when latest tag is not valid semver in publishOnly mode", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("vnot-semver");

    await capturedAction.value!(undefined, {
      ...defaultOptions,
      publishOnly: true,
    });

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Cannot parse the latest tag"),
      }),
    );
  });

  it("should throw when version not provided and not publishOnly in CI", async () => {
    mockIsCI.isCI = true;

    await capturedAction.value!(undefined, {
      ...defaultOptions,
      publishOnly: false,
    });

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Version must be set in the CI environment",
        ),
      }),
    );
  });

  it("should not call notifyNewVersion in CI mode", async () => {
    mockIsCI.isCI = true;

    await capturedAction.value!(undefined, {
      ...defaultOptions,
      publishOnly: false,
    });

    expect(mockNotifyNewVersion).not.toHaveBeenCalled();
  });

  it("should not call requiredMissingInformationTasks in CI mode", async () => {
    mockIsCI.isCI = true;

    await capturedAction.value!(undefined, {
      ...defaultOptions,
      publishOnly: false,
    });

    expect(mockRequiredMissingInformationTasks).not.toHaveBeenCalled();
  });
});

describe("CLI action handler - error handling", () => {
  it("should call consoleError when pubm throws", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });
    const error = new Error("publish failed");
    mockPubm.mockRejectedValue(error);

    await capturedAction.value!("1.0.0", {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockConsoleError).toHaveBeenCalledWith(error);
  });

  it("should set process.exitCode to 1 when an error occurs", async () => {
    mockIsCI.isCI = false;
    const mockRun = vi.fn();
    mockRequiredMissingInformationTasks.mockReturnValue({ run: mockRun });
    const error = new Error("publish failed");
    mockPubm.mockRejectedValue(error);
    process.exitCode = undefined;

    await capturedAction.value!("1.0.0", {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(process.exitCode).toBe(1);
    // Reset for other tests
    process.exitCode = undefined;
  });

  it("should call consoleError when requiredMissingInformationTasks throws", async () => {
    mockIsCI.isCI = false;
    const error = new Error("interactive task failed");
    mockRequiredMissingInformationTasks.mockReturnValue({
      run: vi.fn().mockRejectedValue(error),
    });

    await capturedAction.value!(undefined, {
      publish: true,
      releaseDraft: true,
      tests: true,
      build: true,
      preCheck: true,
      conditionCheck: true,
      tag: "latest",
      publishOnly: false,
    });

    expect(mockConsoleError).toHaveBeenCalledWith(error);
  });
});

describe("help customization", () => {
  it("should append version format info to the second section", () => {
    const sections = [
      { body: "Usage info" },
      { body: "Commands" },
      { body: "placeholder1" },
      { body: "placeholder2" },
      { body: "Options with (default: true) text" },
    ];

    capturedHelpCallback.value!(sections);

    expect(sections[1].body).toContain("Version can be:");
    // semver.RELEASE_TYPES includes all release types
    expect(sections[1].body).toContain("major");
    expect(sections[1].body).toContain("minor");
    expect(sections[1].body).toContain("patch");
    expect(sections[1].body).toContain("premajor");
    expect(sections[1].body).toContain("prerelease");
    expect(sections[1].body).toContain("1.2.3");
  });

  it("should splice out two sections at index 2", () => {
    const sections = [
      { body: "section0" },
      { body: "section1" },
      { body: "will be removed 1" },
      { body: "will be removed 2" },
      { body: "Options (default: true) here" },
    ];

    capturedHelpCallback.value!(sections);

    // After splice(2, 2), the removed sections should no longer be present
    expect(sections.some((s) => s.body === "will be removed 1")).toBe(false);
    expect(sections.some((s) => s.body === "will be removed 2")).toBe(false);
  });

  it('should strip "(default: true)" from the options section', () => {
    const sections = [
      { body: "section0" },
      { body: "section1" },
      { body: "removed1" },
      { body: "removed2" },
      { body: "--no-tests (default: true)\n--no-build (default: true)" },
    ];

    capturedHelpCallback.value!(sections);

    // After splice(2, 2), the options section is at index 2
    expect(sections[2].body).not.toContain("(default: true)");
    expect(sections[2].body).toContain("--no-tests");
    expect(sections[2].body).toContain("--no-build");
  });

  it("should push a trailing newline section", () => {
    const sections = [
      { body: "section0" },
      { body: "section1" },
      { body: "removed1" },
      { body: "removed2" },
      { body: "options" },
    ];

    capturedHelpCallback.value!(sections);

    const lastSection = sections[sections.length - 1];
    expect(lastSection.body).toBe("\n");
  });

  it("should handle case where sections.at(2) is undefined after splice", () => {
    const sections = [
      { body: "section0" },
      { body: "section1" },
      { body: "removed1" },
      { body: "removed2" },
    ];

    // After splice(2, 2), there is no section at index 2
    // This should not throw
    expect(() => capturedHelpCallback.value!(sections)).not.toThrow();
  });
});
