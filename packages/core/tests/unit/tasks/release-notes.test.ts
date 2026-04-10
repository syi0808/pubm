import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangelogSection } from "../../../src/changelog/types.js";

// These vi.mock calls MUST be at file top level
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../../../src/utils/clipboard.js", () => ({
  copyToClipboard: vi.fn(),
}));

async function freshImport() {
  vi.resetModules();
  return await import("../../../src/tasks/release-notes.js");
}

async function getMocks() {
  const fs = await import("node:fs");
  const { Git } = await import("../../../src/git.js");
  const { execFileSync } = await import("node:child_process");
  const { copyToClipboard } = await import("../../../src/utils/clipboard.js");
  return {
    mockExistsSync: vi.mocked(fs.existsSync),
    mockReadFileSync: vi.mocked(fs.readFileSync),
    mockGit: vi.mocked(Git),
    mockExecFileSync: vi.mocked(execFileSync),
    mockCopyToClipboard: vi.mocked(copyToClipboard),
  };
}

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    cwd: "/project",
    config: { packages: [{ path: "packages/core", name: "@pubm/core" }] },
    ...overrides,
  } as any;
}

describe("renderReleaseNoteSections", () => {
  it("renders sections with category headers", async () => {
    const { renderReleaseNoteSections } = await freshImport();
    const sections: ChangelogSection[] = [
      { category: "Features", items: ["- add glob support (a1b2c3d)"] },
      { category: "Bug Fixes", items: ["- fix path resolution (c3d4e5f)"] },
    ];
    const result = renderReleaseNoteSections(sections);
    expect(result).toBe(
      "### Features\n\n- add glob support (a1b2c3d)\n\n### Bug Fixes\n\n- fix path resolution (c3d4e5f)",
    );
  });

  it("renders multiple items within a section", async () => {
    const { renderReleaseNoteSections } = await freshImport();
    const sections: ChangelogSection[] = [
      {
        category: "Features",
        items: ["- feat one (a1b2c3d)", "- feat two (b2c3d4e)"],
      },
    ];
    const result = renderReleaseNoteSections(sections);
    expect(result).toBe(
      "### Features\n\n- feat one (a1b2c3d)\n- feat two (b2c3d4e)",
    );
  });

  it("returns empty string for empty sections", async () => {
    const { renderReleaseNoteSections } = await freshImport();
    expect(renderReleaseNoteSections([])).toBe("");
  });

  it("renders sections without category as plain items", async () => {
    const { renderReleaseNoteSections } = await freshImport();
    const sections: ChangelogSection[] = [
      { items: ["- uncategorized item (abc1234)"] },
    ];
    const result = renderReleaseNoteSections(sections);
    expect(result).toBe("- uncategorized item (abc1234)");
  });
});

describe("buildReleaseBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses CHANGELOG.md when available", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "# Changelog\n\n## 1.0.0\n\n### Minor Changes\n\n- new feature\n\n## 0.9.0\n\n- old\n",
    );
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("abc123"),
      } as any;
    } as any);

    const result = await buildReleaseBody(makeCtx(), {
      pkgPath: "packages/core",
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("### Minor Changes");
    expect(result).toContain("- new feature");
    expect(result).toContain(
      "**Full Changelog**: https://github.com/user/repo/compare/v0.9.0...v1.0.0",
    );
  });

  it("falls back to conventional commits when no CHANGELOG.md", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "ignored0000000000000000000000000000000000",
            message: "ignored",
          },
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: add glob support",
          },
          {
            id: "bcdef1234567890abcdef1234567890abcdef123",
            message: "fix: resolve path issue",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: add glob support\n\nCOMMIT_FILES\nsrc/glob.ts\n" +
        "COMMIT_START bcdef12\nfix: resolve path issue\n\nCOMMIT_FILES\nsrc/path.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("### Features");
    expect(result).toContain("add glob support");
    expect(result).toContain("### Bug Fixes");
    expect(result).toContain("resolve path issue");
    expect(result).toContain("**Full Changelog**");
  });

  it("filters commits by package scope in monorepo independent mode", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "ignored0000000000000000000000000000000000",
            message: "ignored",
          },
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: add core feature",
          },
          {
            id: "bcdef1234567890abcdef1234567890abcdef123",
            message: "fix: fix cli bug",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: add core feature\n\nCOMMIT_FILES\npackages/core/src/index.ts\n" +
        "COMMIT_START bcdef12\nfix: fix cli bug\n\nCOMMIT_FILES\npackages/pubm/src/cli.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      pkgPath: "packages/core",
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("add core feature");
    expect(result).not.toContain("fix cli bug");
  });

  it("falls back to raw commit list when no conventional commits", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "ignored0000000000000000000000000000000000",
            message: "ignored",
          },
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "update dependencies",
          },
          {
            id: "bcdef1234567890abcdef1234567890abcdef123",
            message: "bump version",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nupdate dependencies\n\nCOMMIT_FILES\n" +
        "COMMIT_START bcdef12\nbump version\n\nCOMMIT_FILES\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("- update dependencies (abcdef1)");
    expect(result).toContain("- bump version (bcdef12)");
    expect(result).toContain("**Full Changelog**");
  });

  it("uses conventional path when at least one commit is conventional", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue(null),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "ignored0000000000000000000000000000000000",
            message: "ignored",
          },
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: one conventional",
          },
          {
            id: "bcdef1234567890abcdef1234567890abcdef123",
            message: "non-conventional message",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: one conventional\n\nCOMMIT_FILES\n" +
        "COMMIT_START bcdef12\nnon-conventional message\n\nCOMMIT_FILES\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("### Features");
    expect(result).toContain("one conventional");
  });

  it("omits compare link when appendCompareLink is false", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Changelog\n\n## 1.0.0\n\n- feature\n");
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("abc123"),
      } as any;
    } as any);

    const result = await buildReleaseBody(makeCtx(), {
      pkgPath: "packages/core",
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
      appendCompareLink: false,
    });

    expect(result).not.toContain("**Full Changelog**");
  });
});

describe("buildFixedReleaseBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates per-package bodies with headers and single compare link", async () => {
    const { buildFixedReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce("# Changelog\n\n## 1.0.0\n\n- core feature\n")
      .mockReturnValueOnce("# Changelog\n\n## 1.0.0\n\n- cli update\n");

    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
      } as any;
    } as any);

    const ctx = makeCtx({
      config: {
        packages: [
          { path: "packages/core", name: "@pubm/core" },
          { path: "packages/pubm", name: "pubm" },
        ],
      },
    });

    const result = await buildFixedReleaseBody(ctx, {
      packages: [
        { pkgPath: "packages/core", pkgName: "@pubm/core", version: "1.0.0" },
        { pkgPath: "packages/pubm", pkgName: "pubm", version: "1.0.0" },
      ],
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("## @pubm/core v1.0.0");
    expect(result).toContain("- core feature");
    expect(result).toContain("---");
    expect(result).toContain("## pubm v1.0.0");
    expect(result).toContain("- cli update");
    // Single compare link at end
    const compareMatches = result.match(/\*\*Full Changelog\*\*/g);
    expect(compareMatches).toHaveLength(1);
    expect(result).toContain(
      "https://github.com/user/repo/compare/v0.9.0...v1.0.0",
    );
  });

  it("handles packages falling back to raw commits", async () => {
    const { buildFixedReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit, mockExecFileSync } =
      await getMocks();

    // First package has changelog, second doesn't
    mockExistsSync.mockReturnValueOnce(true).mockReturnValue(false);
    mockReadFileSync.mockReturnValue(
      "# Changelog\n\n## 1.0.0\n\n- core feature\n",
    );
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "ignored0000000000000000000000000000000000",
            message: "ignored",
          },
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "update dep",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nupdate dep\n\nCOMMIT_FILES\n",
    );

    const ctx = makeCtx({
      config: {
        packages: [
          { path: "packages/core", name: "@pubm/core" },
          { path: "packages/pubm", name: "pubm" },
        ],
      },
    });

    const result = await buildFixedReleaseBody(ctx, {
      packages: [
        { pkgPath: "packages/core", pkgName: "@pubm/core", version: "1.0.0" },
        { pkgPath: "packages/pubm", pkgName: "pubm", version: "1.0.0" },
      ],
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("## @pubm/core v1.0.0");
    expect(result).toContain("## pubm v1.0.0");
    expect(result).toContain("- update dep (abcdef1)");
  });
});

describe("truncateForUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns body unchanged when URL is within limit", async () => {
    const { truncateForUrl } = await freshImport();

    const body = "short body";
    const baseUrl =
      "https://github.com/user/repo/releases/new?tag=v1.0.0&prerelease=false&body=";

    const result = await truncateForUrl(body, baseUrl);
    expect(result.body).toBe(body);
    expect(result.truncated).toBe(false);
    expect(result.clipboardCopied).toBe(false);
  });

  it("truncates and copies to clipboard when URL exceeds limit", async () => {
    const { truncateForUrl } = await freshImport();
    const { mockCopyToClipboard } = await getMocks();
    mockCopyToClipboard.mockResolvedValue(true);

    const body = "x".repeat(10000);
    const baseUrl =
      "https://github.com/user/repo/releases/new?tag=v1.0.0&prerelease=false&body=";

    const result = await truncateForUrl(body, baseUrl);
    expect(result.body.length).toBeLessThan(body.length);
    expect(result.body).toContain("truncated");
    expect(result.truncated).toBe(true);
    expect(result.clipboardCopied).toBe(true);
    expect(mockCopyToClipboard).toHaveBeenCalledWith(body);
  });

  it("uses plain truncated message when clipboard fails", async () => {
    const { truncateForUrl } = await freshImport();
    const { mockCopyToClipboard } = await getMocks();
    mockCopyToClipboard.mockResolvedValue(false);

    const body = "x".repeat(10000);
    const baseUrl =
      "https://github.com/user/repo/releases/new?tag=v1.0.0&prerelease=false&body=";

    const result = await truncateForUrl(body, baseUrl);
    expect(result.body).toContain("truncated");
    expect(result.truncated).toBe(true);
    expect(result.clipboardCopied).toBe(false);
  });
});
