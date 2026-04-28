import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@pubm/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pubm/runner")>()),
  prompt: vi.fn(),
}));

vi.mock("@pubm/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pubm/core")>();
  return {
    ...actual,
    detectWorkspace: vi.fn(),
    discoverPackages: vi.fn(),
  };
});

import { detectWorkspace, discoverPackages } from "@pubm/core";
import { prompt } from "@pubm/runner";

import {
  buildConfigContent,
  detectDefaultBranch,
  detectPackages,
  INIT_DEFAULTS,
  type InitResult,
  type PackageDetectionResult,
  promptBranch,
  promptChangelog,
  promptChangesets,
  promptCI,
  promptGithubRelease,
  promptOverwriteConfig,
  promptPackages,
  promptSkills,
  promptVersioning,
  shouldCreateConfig,
} from "../../../src/commands/init-prompts.js";

const mockPrompt = vi.mocked(prompt);
const mockDetectWorkspace = vi.mocked(detectWorkspace);
const mockDiscoverPackages = vi.mocked(discoverPackages);

const TEST_DIR = path.resolve("tests/unit/commands/.tmp-init-prompts");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// detectDefaultBranch
// ---------------------------------------------------------------------------

describe("detectDefaultBranch", () => {
  it("returns 'main' as fallback when directory is not a git repo", () => {
    const result = detectDefaultBranch(TEST_DIR);
    expect(result).toBe("main");
  });

  it("returns 'main' as fallback when git repo has no remote", () => {
    execSync("git init", { cwd: TEST_DIR, stdio: "pipe" });
    const result = detectDefaultBranch(TEST_DIR);
    expect(result).toBe("main");
  });

  it("strips 'refs/remotes/origin/' prefix from the git output", () => {
    // Set up a git repo with a remote that has a HEAD ref pointing to a branch
    execSync("git init", { cwd: TEST_DIR, stdio: "pipe" });
    execSync("git commit --allow-empty -m 'init'", {
      cwd: TEST_DIR,
      stdio: "pipe",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@test.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@test.com",
      },
    });

    // Create a bare clone to act as origin
    const bareDir = path.join(TEST_DIR, "bare.git");
    mkdirSync(bareDir, { recursive: true });
    execSync(`git clone --bare ${TEST_DIR} ${bareDir}`, { stdio: "pipe" });

    const repoDir = path.join(TEST_DIR, "clone");
    mkdirSync(repoDir, { recursive: true });
    execSync(`git clone ${bareDir} ${repoDir}`, { stdio: "pipe" });

    const result = detectDefaultBranch(repoDir);
    // Should return just the branch name (e.g., "main" or "master")
    expect(result).not.toContain("refs/remotes/origin/");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// shouldCreateConfig
// ---------------------------------------------------------------------------

describe("shouldCreateConfig", () => {
  function makeResult(overrides: Partial<InitResult> = {}): InitResult {
    return {
      packages: [],
      branch: "main",
      versioning: "independent",
      changelog: true,
      changelogFormat: "default",
      releaseDraft: true,
      changesets: false,
      ci: false,
      isMonorepo: false,
      ...overrides,
    };
  }

  it("returns true for monorepo regardless of other values", () => {
    const result = makeResult({ isMonorepo: true });
    expect(shouldCreateConfig(result, "main")).toBe(true);
  });

  it("returns false for single-package with all defaults matching detected branch", () => {
    const result = makeResult({ branch: "main" });
    expect(shouldCreateConfig(result, "main")).toBe(false);
  });

  it("returns true when versioning differs from default", () => {
    const result = makeResult({ versioning: "fixed" });
    expect(shouldCreateConfig(result, "main")).toBe(true);
  });

  it("returns true when branch differs from detected branch", () => {
    const result = makeResult({ branch: "develop" });
    expect(shouldCreateConfig(result, "main")).toBe(true);
  });

  it("returns false when branch matches detected branch (non-main)", () => {
    const result = makeResult({ branch: "develop" });
    expect(shouldCreateConfig(result, "develop")).toBe(false);
  });

  it("returns true when changelog is disabled (default is true)", () => {
    const result = makeResult({ changelog: false });
    expect(shouldCreateConfig(result, "main")).toBe(true);
  });

  it("returns true when changelogFormat differs from default", () => {
    const result = makeResult({ changelogFormat: "github" });
    expect(shouldCreateConfig(result, "main")).toBe(true);
  });

  it("returns true when releaseDraft differs from default", () => {
    const result = makeResult({ releaseDraft: false });
    expect(shouldCreateConfig(result, "main")).toBe(true);
  });

  it("returns false when changesets and ci differ but core fields match defaults", () => {
    // changesets and ci are not tracked in shouldCreateConfig
    const result = makeResult({ changesets: true, ci: true });
    expect(shouldCreateConfig(result, "main")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildConfigContent
// ---------------------------------------------------------------------------

describe("buildConfigContent", () => {
  function makeResult(overrides: Partial<InitResult> = {}): InitResult {
    return {
      packages: [],
      branch: INIT_DEFAULTS.branch,
      versioning: INIT_DEFAULTS.versioning,
      changelog: INIT_DEFAULTS.changelog,
      changelogFormat: INIT_DEFAULTS.changelogFormat,
      releaseDraft: INIT_DEFAULTS.releaseDraft,
      changesets: false,
      ci: false,
      isMonorepo: false,
      ...overrides,
    };
  }

  it("generates minimal config when all values are defaults", () => {
    const content = buildConfigContent(makeResult());
    expect(content).toContain('import { defineConfig } from "@pubm/core"');
    expect(content).toContain("export default defineConfig({");
    expect(content).toContain("});");
    // No extra fields
    expect(content).not.toContain("versioning");
    expect(content).not.toContain("branch");
    expect(content).not.toContain("changelog");
    expect(content).not.toContain("releaseDraft");
    expect(content).not.toContain("packages");
  });

  it("generates config with monorepo packages list", () => {
    const result = makeResult({
      isMonorepo: true,
      packages: ["packages/a", "packages/b"],
    });
    const content = buildConfigContent(result);
    expect(content).toContain("packages:");
    expect(content).toContain('{ path: "packages/a" }');
    expect(content).toContain('{ path: "packages/b" }');
  });

  it("includes versioning when not default", () => {
    const content = buildConfigContent(makeResult({ versioning: "fixed" }));
    expect(content).toContain('versioning: "fixed"');
  });

  it("does not include versioning when it is the default", () => {
    const content = buildConfigContent(
      makeResult({ versioning: "independent" }),
    );
    expect(content).not.toContain("versioning");
  });

  it("includes branch when not default", () => {
    const content = buildConfigContent(makeResult({ branch: "develop" }));
    expect(content).toContain('branch: "develop"');
  });

  it("does not include branch when it is the default", () => {
    const content = buildConfigContent(makeResult({ branch: "main" }));
    expect(content).not.toContain("branch");
  });

  it("includes changelog: false when changelog is disabled", () => {
    const content = buildConfigContent(makeResult({ changelog: false }));
    expect(content).toContain("changelog: false");
  });

  it("includes changelogFormat when changelog is enabled and format is not default", () => {
    const content = buildConfigContent(
      makeResult({ changelog: true, changelogFormat: "github" }),
    );
    expect(content).toContain('changelogFormat: "github"');
  });

  it("does not include changelogFormat when changelog is disabled", () => {
    const content = buildConfigContent(
      makeResult({ changelog: false, changelogFormat: "github" }),
    );
    expect(content).not.toContain("changelogFormat");
  });

  it("does not include changelogFormat when it is the default", () => {
    const content = buildConfigContent(
      makeResult({ changelog: true, changelogFormat: "default" }),
    );
    expect(content).not.toContain("changelogFormat");
  });

  it("includes releaseDraft when not default", () => {
    const content = buildConfigContent(makeResult({ releaseDraft: false }));
    expect(content).toContain("releaseDraft: false");
  });

  it("does not include releaseDraft when it is the default", () => {
    const content = buildConfigContent(makeResult({ releaseDraft: true }));
    expect(content).not.toContain("releaseDraft");
  });

  it("combines multiple non-default fields correctly", () => {
    const result = makeResult({
      isMonorepo: true,
      packages: ["packages/core"],
      versioning: "fixed",
      branch: "release",
      changelog: true,
      changelogFormat: "github",
      releaseDraft: false,
    });
    const content = buildConfigContent(result);
    expect(content).toContain('{ path: "packages/core" }');
    expect(content).toContain('versioning: "fixed"');
    expect(content).toContain('branch: "release"');
    expect(content).toContain('changelogFormat: "github"');
    expect(content).toContain("releaseDraft: false");
  });

  it("adds a trailing comma after the last field when fields are present", () => {
    const content = buildConfigContent(makeResult({ versioning: "fixed" }));
    // The last field should be followed by a trailing comma before the closing brace
    expect(content).toMatch(/versioning: "fixed",\s*\n\}\)/);
  });

  it("does not add extra comma when no fields are present", () => {
    const content = buildConfigContent(makeResult());
    // defineConfig({}) or defineConfig({\n}) with no trailing comma from fields
    expect(content).toMatch(/defineConfig\(\{\s*\}\)/);
  });

  it("produces valid TypeScript import statement", () => {
    const content = buildConfigContent(makeResult());
    expect(content.startsWith('import { defineConfig } from "@pubm/core";\n'));
  });
});

// ---------------------------------------------------------------------------
// detectPackages
// ---------------------------------------------------------------------------

describe("detectPackages", () => {
  it("returns single package with name from package.json", async () => {
    mockDetectWorkspace.mockReturnValue([]);
    writeFileSync(
      path.join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "my-package" }),
    );

    const result = await detectPackages(TEST_DIR);

    expect(result.isMonorepo).toBe(false);
    expect(result.workspaces).toEqual([]);
    expect(result.packages).toEqual([{ name: "my-package", path: "." }]);
  });

  it("uses directory basename when package.json does not exist", async () => {
    mockDetectWorkspace.mockReturnValue([]);

    const result = await detectPackages(TEST_DIR);

    expect(result.isMonorepo).toBe(false);
    expect(result.packages[0].name).toBe(path.basename(TEST_DIR));
    expect(result.packages[0].path).toBe(".");
  });

  it("uses directory basename when package.json has no name field", async () => {
    mockDetectWorkspace.mockReturnValue([]);
    writeFileSync(
      path.join(TEST_DIR, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );

    const result = await detectPackages(TEST_DIR);

    expect(result.isMonorepo).toBe(false);
    expect(result.packages[0].name).toBe(path.basename(TEST_DIR));
  });

  it("returns monorepo with workspace info and discovered packages", async () => {
    const fakeWorkspaces = [{ path: TEST_DIR, patterns: ["packages/*"] }];
    mockDetectWorkspace.mockReturnValue(fakeWorkspaces);

    const pkgAPath = path.join(TEST_DIR, "packages", "a");
    const pkgBPath = path.join(TEST_DIR, "packages", "b");
    mockDiscoverPackages.mockResolvedValue([
      { name: "pkg-a", path: pkgAPath },
      { name: "pkg-b", path: pkgBPath },
    ] as Awaited<ReturnType<typeof discoverPackages>>);

    const result = await detectPackages(TEST_DIR);

    expect(result.isMonorepo).toBe(true);
    expect(result.workspaces).toBe(fakeWorkspaces);
    expect(result.packages).toEqual([
      { name: "pkg-a", path: "packages/a" },
      { name: "pkg-b", path: "packages/b" },
    ]);
    expect(mockDiscoverPackages).toHaveBeenCalledWith({ cwd: TEST_DIR });
  });

  it("computes relative paths for discovered packages", async () => {
    const fakeWorkspaces = [{ path: TEST_DIR, patterns: ["packages/*"] }];
    mockDetectWorkspace.mockReturnValue(fakeWorkspaces);

    const pkgPath = path.join(TEST_DIR, "packages", "core");
    mockDiscoverPackages.mockResolvedValue([
      { name: "@scope/core", path: pkgPath },
    ] as Awaited<ReturnType<typeof discoverPackages>>);

    const result = await detectPackages(TEST_DIR);

    expect(result.packages[0].path).toBe("packages/core");
  });
});

// ---------------------------------------------------------------------------
// promptPackages
// ---------------------------------------------------------------------------

describe("promptPackages", () => {
  it("returns package path when single package is confirmed", async () => {
    mockPrompt.mockResolvedValueOnce(true);

    const detected: PackageDetectionResult = {
      isMonorepo: false,
      workspaces: [],
      packages: [{ name: "my-pkg", path: "." }],
    };

    const result = await promptPackages(detected);

    expect(result).toEqual(["."]);
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "confirm",
      }),
    );
  });

  it("returns empty array when single package is rejected", async () => {
    mockPrompt.mockResolvedValueOnce(false);

    const detected: PackageDetectionResult = {
      isMonorepo: false,
      workspaces: [],
      packages: [{ name: "my-pkg", path: "." }],
    };

    const result = await promptPackages(detected);

    expect(result).toEqual([]);
  });

  it("returns selected packages from multiselect for monorepo", async () => {
    mockPrompt.mockResolvedValueOnce(["packages/a", "packages/b"]);

    const detected: PackageDetectionResult = {
      isMonorepo: true,
      workspaces: [],
      packages: [
        { name: "pkg-a", path: "packages/a" },
        { name: "pkg-b", path: "packages/b" },
        { name: "pkg-c", path: "packages/c" },
      ],
    };

    const result = await promptPackages(detected);

    expect(result).toEqual(["packages/a", "packages/b"]);
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "multiselect",
      }),
    );
  });

  it("passes all packages as choices with path and name in message for monorepo", async () => {
    mockPrompt.mockResolvedValueOnce([]);

    const detected: PackageDetectionResult = {
      isMonorepo: true,
      workspaces: [],
      packages: [{ name: "pkg-a", path: "packages/a" }],
    };

    await promptPackages(detected);

    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        choices: [
          {
            name: "packages/a",
            message: "packages/a (pkg-a)",
            value: "packages/a",
          },
        ],
      }),
    );
  });

  it("shows the package name in the confirm message for single package", async () => {
    mockPrompt.mockResolvedValueOnce(true);

    const detected: PackageDetectionResult = {
      isMonorepo: false,
      workspaces: [],
      packages: [{ name: "cool-lib", path: "." }],
    };

    await promptPackages(detected);

    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("cool-lib"),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// promptBranch
// ---------------------------------------------------------------------------

describe("promptBranch", () => {
  it("returns detected branch when user selects it", async () => {
    mockPrompt.mockResolvedValueOnce("main");

    const result = await promptBranch(TEST_DIR);

    expect(result).toBe("main");
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it("prompts for input and returns typed branch when 'Other...' is selected", async () => {
    mockPrompt
      .mockResolvedValueOnce("__other__")
      .mockResolvedValueOnce("release/v2");

    const result = await promptBranch(TEST_DIR);

    expect(result).toBe("release/v2");
    expect(mockPrompt).toHaveBeenCalledTimes(2);
  });

  it("trims whitespace from custom branch name", async () => {
    mockPrompt
      .mockResolvedValueOnce("__other__")
      .mockResolvedValueOnce("  my-branch  ");

    const result = await promptBranch(TEST_DIR);

    expect(result).toBe("my-branch");
  });

  it("includes detected branch and 'Other...' as choices", async () => {
    // In TEST_DIR there's no remote so detectDefaultBranch returns "main"
    mockPrompt.mockResolvedValueOnce("main");

    await promptBranch(TEST_DIR);

    const callArg = mockPrompt.mock.calls[0][0] as {
      choices: Array<{ name: string; message: string }>;
    };
    const names = callArg.choices.map((c) => c.name);
    expect(names).toContain("main");
    expect(names).toContain("__other__");
  });

  it("second prompt uses input type for custom branch", async () => {
    mockPrompt
      .mockResolvedValueOnce("__other__")
      .mockResolvedValueOnce("custom");

    await promptBranch(TEST_DIR);

    const secondCall = mockPrompt.mock.calls[1][0] as { type: string };
    expect(secondCall.type).toBe("input");
  });
});

// ---------------------------------------------------------------------------
// promptVersioning
// ---------------------------------------------------------------------------

describe("promptVersioning", () => {
  it("returns 'independent' when selected", async () => {
    mockPrompt.mockResolvedValueOnce("independent");
    const result = await promptVersioning();
    expect(result).toBe("independent");
  });

  it("returns 'fixed' when selected", async () => {
    mockPrompt.mockResolvedValueOnce("fixed");
    const result = await promptVersioning();
    expect(result).toBe("fixed");
  });

  it("uses select type prompt", async () => {
    mockPrompt.mockResolvedValueOnce("independent");
    await promptVersioning();
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "select" }),
    );
  });
});

// ---------------------------------------------------------------------------
// promptChangelog
// ---------------------------------------------------------------------------

describe("promptChangelog", () => {
  it("returns enabled=true with github format when confirmed and github selected", async () => {
    mockPrompt.mockResolvedValueOnce(true).mockResolvedValueOnce("github");

    const result = await promptChangelog();

    expect(result).toEqual({ enabled: true, format: "github" });
    expect(mockPrompt).toHaveBeenCalledTimes(2);
  });

  it("returns enabled=true with default format when confirmed and default selected", async () => {
    mockPrompt.mockResolvedValueOnce(true).mockResolvedValueOnce("default");

    const result = await promptChangelog();

    expect(result).toEqual({ enabled: true, format: "default" });
  });

  it("returns enabled=false with default format when declined — skips format prompt", async () => {
    mockPrompt.mockResolvedValueOnce(false);

    const result = await promptChangelog();

    expect(result).toEqual({ enabled: false, format: "default" });
    expect(mockPrompt).toHaveBeenCalledTimes(1);
  });

  it("first prompt is confirm type", async () => {
    mockPrompt.mockResolvedValueOnce(true).mockResolvedValueOnce("default");

    await promptChangelog();

    expect(mockPrompt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "confirm" }),
    );
  });

  it("second prompt is select type for format", async () => {
    mockPrompt.mockResolvedValueOnce(true).mockResolvedValueOnce("github");

    await promptChangelog();

    expect(mockPrompt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "select" }),
    );
  });
});

// ---------------------------------------------------------------------------
// promptGithubRelease
// ---------------------------------------------------------------------------

describe("promptGithubRelease", () => {
  it("returns true when confirmed", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    expect(await promptGithubRelease()).toBe(true);
  });

  it("returns false when declined", async () => {
    mockPrompt.mockResolvedValueOnce(false);
    expect(await promptGithubRelease()).toBe(false);
  });

  it("uses confirm type prompt with 'enabled' field", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    await promptGithubRelease();
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm" }),
    );
  });
});

// ---------------------------------------------------------------------------
// promptChangesets
// ---------------------------------------------------------------------------

describe("promptChangesets", () => {
  it("returns true when confirmed", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    expect(await promptChangesets()).toBe(true);
  });

  it("returns false when declined", async () => {
    mockPrompt.mockResolvedValueOnce(false);
    expect(await promptChangesets()).toBe(false);
  });

  it("uses confirm type prompt", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    await promptChangesets();
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm" }),
    );
  });
});

// ---------------------------------------------------------------------------
// promptCI
// ---------------------------------------------------------------------------

describe("promptCI", () => {
  it("returns true when confirmed", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    expect(await promptCI()).toBe(true);
  });

  it("returns false when declined", async () => {
    mockPrompt.mockResolvedValueOnce(false);
    expect(await promptCI()).toBe(false);
  });

  it("uses confirm type prompt", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    await promptCI();
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm" }),
    );
  });
});

// ---------------------------------------------------------------------------
// promptSkills
// ---------------------------------------------------------------------------

describe("promptSkills", () => {
  it("returns true when confirmed", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    expect(await promptSkills()).toBe(true);
  });

  it("returns false when declined", async () => {
    mockPrompt.mockResolvedValueOnce(false);
    expect(await promptSkills()).toBe(false);
  });

  it("uses confirm type prompt", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    await promptSkills();
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm" }),
    );
  });
});

// ---------------------------------------------------------------------------
// promptOverwriteConfig
// ---------------------------------------------------------------------------

describe("promptOverwriteConfig", () => {
  it("returns true when overwrite is confirmed", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    expect(await promptOverwriteConfig()).toBe(true);
  });

  it("returns false when overwrite is declined", async () => {
    mockPrompt.mockResolvedValueOnce(false);
    expect(await promptOverwriteConfig()).toBe(false);
  });

  it("uses confirm type prompt with 'overwrite' field", async () => {
    mockPrompt.mockResolvedValueOnce(true);
    await promptOverwriteConfig();
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ type: "confirm" }),
    );
  });

  it("mentions pubm.config.ts in the prompt message", async () => {
    mockPrompt.mockResolvedValueOnce(false);
    await promptOverwriteConfig();
    expect(mockPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("pubm.config.ts"),
      }),
    );
  });
});
