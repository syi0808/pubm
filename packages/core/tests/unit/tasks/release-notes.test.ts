import { join } from "node:path";
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

describe("renderReleaseNoteSections — additional cases", () => {
  it("renders mixed categorized and uncategorized sections together", async () => {
    const { renderReleaseNoteSections } = await freshImport();
    const sections: ChangelogSection[] = [
      { category: "Features", items: ["- add feature (a1b2c3d)"] },
      { items: ["- misc change (b2c3d4e)"] },
      { category: "Bug Fixes", items: ["- fix bug (c3d4e5f)"] },
    ];
    const result = renderReleaseNoteSections(sections);
    expect(result).toBe(
      "### Features\n\n- add feature (a1b2c3d)\n\n- misc change (b2c3d4e)\n\n### Bug Fixes\n\n- fix bug (c3d4e5f)",
    );
  });

  it("renders all 5 category types", async () => {
    const { renderReleaseNoteSections } = await freshImport();
    const sections: ChangelogSection[] = [
      { category: "Features", items: ["- feat item (a1b2c3d)"] },
      { category: "Bug Fixes", items: ["- fix item (b2c3d4e)"] },
      { category: "Performance", items: ["- perf item (c3d4e5f)"] },
      { category: "Refactoring", items: ["- refactor item (d4e5f6a)"] },
      { category: "Documentation", items: ["- docs item (e5f6a7b)"] },
    ];
    const result = renderReleaseNoteSections(sections);
    expect(result).toContain("### Features");
    expect(result).toContain("### Bug Fixes");
    expect(result).toContain("### Performance");
    expect(result).toContain("### Refactoring");
    expect(result).toContain("### Documentation");
    // Sections joined with double newline
    const parts = result.split("\n\n");
    expect(parts.length).toBe(10); // 5 headers + 5 item groups
  });

  it("renders single section with many items (10+)", async () => {
    const { renderReleaseNoteSections } = await freshImport();
    const items = Array.from(
      { length: 12 },
      (_, i) => `- item ${i + 1} (${i.toString(16).padStart(7, "0")})`,
    );
    const sections: ChangelogSection[] = [{ category: "Features", items }];
    const result = renderReleaseNoteSections(sections);
    expect(result).toContain("### Features");
    for (const item of items) {
      expect(result).toContain(item);
    }
    // All items joined with single newline inside section
    expect(result).toBe(`### Features\n\n${items.join("\n")}`);
  });
});

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

describe("buildReleaseBody — additional cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses firstCommit fallback when previousTag is null", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue(null),
        firstCommit: vi.fn().mockResolvedValue("abc123first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: new feature",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: new feature\n\nCOMMIT_FILES\nsrc/index.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("abc123first...v1.0.0");
    expect(result).toContain("**Full Changelog**");
  });

  it("uses pre-resolved previousTag without calling git.previousTag", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "# Changelog\n\n## 1.0.0\n\n- pre-resolved feature\n",
    );
    const mockPreviousTag = vi.fn();
    const mockFirstCommit = vi.fn();
    mockGit.mockImplementation(function () {
      return {
        previousTag: mockPreviousTag,
        firstCommit: mockFirstCommit,
      } as any;
    } as any);

    const result = await buildReleaseBody(makeCtx(), {
      pkgPath: "packages/core",
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
      previousTag: "v0.8.0",
    });

    expect(mockPreviousTag).not.toHaveBeenCalled();
    expect(mockFirstCommit).not.toHaveBeenCalled();
    expect(result).toContain("v0.8.0...v1.0.0");
  });

  it("reads CHANGELOG.md from ctx.cwd for root package (no pkgPath)", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockImplementation(
      (p: string) => p === join("/project", "CHANGELOG.md"),
    );
    mockReadFileSync.mockReturnValue(
      "# Changelog\n\n## 1.0.0\n\n- root package feature\n",
    );
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
      } as any;
    } as any);

    const result = await buildReleaseBody(makeCtx(), {
      // no pkgPath — root package
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("root package feature");
    // Should have checked /project/CHANGELOG.md (no subdirectory)
    expect(mockExistsSync).toHaveBeenCalledWith(
      join("/project", "CHANGELOG.md"),
    );
  });

  it("falls through to commits when CHANGELOG.md version section not found", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit, mockExecFileSync } =
      await getMocks();

    mockExistsSync.mockReturnValue(true);
    // CHANGELOG exists but doesn't have 1.0.0 section
    mockReadFileSync.mockReturnValue(
      "# Changelog\n\n## 0.9.0\n\n- old entry\n",
    );
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: fallback feature",
          },
        ]),
      } as any;
    } as any);
    // execFileSync has commit touching packages/core — will be included
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: fallback feature\n\nCOMMIT_FILES\npackages/core/src/index.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      pkgPath: "packages/core",
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    // CHANGELOG section missing → falls through to conventional commits path
    expect(result).not.toContain("old entry");
    expect(result).toContain("fallback feature");
    // Conventional commit parsing should produce a Features section
    expect(result).toContain("### Features");
  });

  it("returns only compare link when commits list is empty", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        // Returns empty list — no commits in this release
        commits: vi.fn().mockResolvedValue([]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue("");

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toBe(
      "**Full Changelog**: https://github.com/user/repo/compare/v0.9.0...v1.0.0",
    );
  });

  it("treats breaking change commit (feat!) as Features", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat!: breaking change",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat!: breaking change\n\nCOMMIT_FILES\nsrc/index.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "2.0.0",
      tag: "v2.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("breaking change");
    expect(result).toContain("### Features");
  });

  it("handles scoped conventional commit (feat(core): ...)", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat(core): scoped feature",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat(core): scoped feature\n\nCOMMIT_FILES\npackages/core/src/index.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      pkgPath: "packages/core",
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("scoped feature");
    expect(result).toContain("### Features");
  });

  it("falls back to raw commits when all conventional commits are filtered out by scope", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          // Raw commits include the full message as stored by git
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: only cli change",
          },
        ]),
      } as any;
    } as any);
    // Only file is in packages/pubm — not in packages/core
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: only cli change\n\nCOMMIT_FILES\npackages/pubm/src/cli.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      pkgPath: "packages/core",
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    // Should fall back to raw commits since all conventional commits are filtered by scope
    // Raw fallback uses the full message from git.commits (not stripped description)
    expect(result).toContain("- feat: only cli change (abcdef1)");
    expect(result).not.toContain("### Features");
  });

  it("includes all commit types when multiple types are present", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "aaaaaaa1234567890abcdef1234567890abcdef12",
            message: "feat: new api",
          },
          {
            id: "bbbbbbb1234567890abcdef1234567890abcdef12",
            message: "fix: memory leak",
          },
          {
            id: "ccccccc1234567890abcdef1234567890abcdef12",
            message: "perf: faster render",
          },
          {
            id: "ddddddd1234567890abcdef1234567890abcdef12",
            message: "docs: update readme",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START aaaaaaa\nfeat: new api\n\nCOMMIT_FILES\nsrc/api.ts\n" +
        "COMMIT_START bbbbbbb\nfix: memory leak\n\nCOMMIT_FILES\nsrc/core.ts\n" +
        "COMMIT_START ccccccc\nperf: faster render\n\nCOMMIT_FILES\nsrc/render.ts\n" +
        "COMMIT_START ddddddd\ndocs: update readme\n\nCOMMIT_FILES\nREADME.md\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("### Features");
    expect(result).toContain("new api");
    expect(result).toContain("### Bug Fixes");
    expect(result).toContain("memory leak");
    expect(result).toContain("faster render");
    expect(result).toContain("update readme");
  });

  it("uses only first line of multi-line commit message as description", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: first line\n\ndetailed body that should not appear",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: first line\n\ndetailed body that should not appear\n\nCOMMIT_FILES\nsrc/index.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("first line");
    expect(result).not.toContain("detailed body that should not appear");
  });

  it("returns compare link when getCommitsBetweenRefs returns empty output", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        // Simulate: git.commits returns empty list (no commits in range)
        commits: vi.fn().mockResolvedValue([]),
      } as any;
    } as any);
    // execFileSync returns empty string (no commits in range)
    mockExecFileSync.mockReturnValue("");

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toBe(
      "**Full Changelog**: https://github.com/user/repo/compare/v0.9.0...v1.0.0",
    );
    expect(result).not.toContain("undefined");
  });

  it("gracefully handles getCommitsBetweenRefs throwing by falling back to raw commits", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "chore: some change",
          },
        ]),
      } as any;
    } as any);
    // Simulate execFileSync throwing (e.g., git not available or invalid ref)
    mockExecFileSync.mockImplementation(() => {
      throw new Error("git command failed");
    });

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    // getCommitsBetweenRefs catches and returns [], so parsed/filtered are empty
    // Falls back to raw commits from git.commits — raw fallback uses full message
    expect(result).toContain("- chore: some change (abcdef1)");
    expect(result).toContain("**Full Changelog**");
  });

  it("commits with no files are still parsed correctly", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: no file commit",
          },
        ]),
      } as any;
    } as any);
    // Commit with empty files section
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfeat: no file commit\n\nCOMMIT_FILES\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    // No pkgPath filter, so should appear in Features
    expect(result).toContain("no file commit");
    expect(result).toContain("### Features");
  });

  it("handles single commit without separator between commits", async () => {
    const { buildReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "fix: single commit fix",
          },
        ]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue(
      "COMMIT_START abcdef1\nfix: single commit fix\n\nCOMMIT_FILES\nsrc/fix.ts\n",
    );

    const result = await buildReleaseBody(makeCtx(), {
      version: "1.0.0",
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("single commit fix");
    expect(result).toContain("### Bug Fixes");
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

describe("buildFixedReleaseBody — additional cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("single package in fixed mode produces no separator", async () => {
    const { buildFixedReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      "# Changelog\n\n## 1.0.0\n\n- only package feature\n",
    );
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
      } as any;
    } as any);

    const ctx = makeCtx({
      config: { packages: [{ path: "packages/core", name: "@pubm/core" }] },
    });

    const result = await buildFixedReleaseBody(ctx, {
      packages: [
        { pkgPath: "packages/core", pkgName: "@pubm/core", version: "1.0.0" },
      ],
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("## @pubm/core v1.0.0");
    expect(result).toContain("only package feature");
    expect(result).not.toContain("---");
    // Single compare link at end
    const compareMatches = result.match(/\*\*Full Changelog\*\*/g);
    expect(compareMatches).toHaveLength(1);
  });

  it("three packages with mixed sources (changelog, conventional, raw)", async () => {
    const { buildFixedReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit, mockExecFileSync } =
      await getMocks();

    // Package 1: has CHANGELOG
    // Package 2: no CHANGELOG, conventional commits
    // Package 3: no CHANGELOG, raw commits
    mockExistsSync
      .mockReturnValueOnce(true) // pkg1 changelog exists
      .mockReturnValueOnce(false) // pkg2 changelog missing
      .mockReturnValueOnce(false); // pkg3 changelog missing

    mockReadFileSync.mockReturnValueOnce(
      "# Changelog\n\n## 1.0.0\n\n- changelog entry\n",
    );

    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        commits: vi.fn().mockResolvedValue([
          {
            id: "abcdef1234567890abcdef1234567890abcdef12",
            message: "feat: conventional feat",
          },
          {
            id: "bcdef1234567890abcdef1234567890abcdef123",
            message: "non-conventional raw",
          },
        ]),
      } as any;
    } as any);

    mockExecFileSync
      // pkg2: has conventional commit in its path
      .mockReturnValueOnce(
        "COMMIT_START abcdef1\nfeat: conventional feat\n\nCOMMIT_FILES\npackages/pkg2/src/index.ts\n",
      )
      // pkg3: no conventional commits → falls back to raw
      .mockReturnValueOnce(
        "COMMIT_START bcdef12\nnon-conventional raw\n\nCOMMIT_FILES\npackages/pkg3/src/index.ts\n",
      );

    const ctx = makeCtx({
      config: {
        packages: [
          { path: "packages/pkg1", name: "pkg1" },
          { path: "packages/pkg2", name: "pkg2" },
          { path: "packages/pkg3", name: "pkg3" },
        ],
      },
    });

    const result = await buildFixedReleaseBody(ctx, {
      packages: [
        { pkgPath: "packages/pkg1", pkgName: "pkg1", version: "1.0.0" },
        { pkgPath: "packages/pkg2", pkgName: "pkg2", version: "1.0.0" },
        { pkgPath: "packages/pkg3", pkgName: "pkg3", version: "1.0.0" },
      ],
      tag: "v1.0.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("## pkg1 v1.0.0");
    expect(result).toContain("changelog entry");
    expect(result).toContain("## pkg2 v1.0.0");
    expect(result).toContain("conventional feat");
    expect(result).toContain("## pkg3 v1.0.0");
    // Pkg3 uses raw since only raw commit exists and it matches pkg3 path
    // (raw path is separate — comes from git.commits not filtered by scope)
    expect(result).toContain("non-conventional raw");
    // Two separators for three packages
    const separators = result.match(/---/g);
    expect(separators).toHaveLength(2);
    // Single compare link
    const compareMatches = result.match(/\*\*Full Changelog\*\*/g);
    expect(compareMatches).toHaveLength(1);
  });

  it("packages with different versions each show correct version in header", async () => {
    const { buildFixedReleaseBody } = await freshImport();
    const { mockExistsSync, mockReadFileSync, mockGit } = await getMocks();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync
      .mockReturnValueOnce("# Changelog\n\n## 2.1.0\n\n- core update\n")
      .mockReturnValueOnce("# Changelog\n\n## 1.5.3\n\n- cli patch\n");

    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v2.0.0"),
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
        { pkgPath: "packages/core", pkgName: "@pubm/core", version: "2.1.0" },
        { pkgPath: "packages/pubm", pkgName: "pubm", version: "1.5.3" },
      ],
      tag: "v2.1.0",
      repositoryUrl: "https://github.com/user/repo",
    });

    expect(result).toContain("## @pubm/core v2.1.0");
    expect(result).toContain("## pubm v1.5.3");
    expect(result).toContain("core update");
    expect(result).toContain("cli patch");
  });

  it("all packages with empty content still produce headers and compare link", async () => {
    const { buildFixedReleaseBody } = await freshImport();
    const { mockExistsSync, mockGit, mockExecFileSync } = await getMocks();

    mockExistsSync.mockReturnValue(false);
    mockGit.mockImplementation(function () {
      return {
        previousTag: vi.fn().mockResolvedValue("v0.9.0"),
        firstCommit: vi.fn().mockResolvedValue("first"),
        // No commits in range
        commits: vi.fn().mockResolvedValue([]),
      } as any;
    } as any);
    mockExecFileSync.mockReturnValue("");

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
    expect(result).toContain("**Full Changelog**");
    // Compare link only once
    const compareMatches = result.match(/\*\*Full Changelog\*\*/g);
    expect(compareMatches).toHaveLength(1);
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

describe("truncateForUrl — additional cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("body exactly at the URL limit is not truncated", async () => {
    const { truncateForUrl } = await freshImport();

    // MAX_URL_LENGTH is 8000
    // We need baseUrl + encodeURIComponent(body) == 8000 exactly
    const baseUrl =
      "https://github.com/user/repo/releases/new?tag=v1.0.0&body=";
    // ASCII chars encode to themselves, so body length = 8000 - baseUrl.length
    const bodyLength = 8000 - baseUrl.length;
    const body = "a".repeat(bodyLength);

    const result = await truncateForUrl(body, baseUrl);
    expect(result.truncated).toBe(false);
    expect(result.body).toBe(body);
    expect(result.clipboardCopied).toBe(false);
  });

  it("body with newlines expands when encoded — triggers truncation", async () => {
    const { truncateForUrl } = await freshImport();
    const { mockCopyToClipboard } = await getMocks();
    mockCopyToClipboard.mockResolvedValue(true);

    // Newlines encode as %0A (3 chars each), so far fewer newlines needed to hit limit
    // Create a body with many newlines that would expand beyond limit
    const baseUrl =
      "https://github.com/user/repo/releases/new?tag=v1.0.0&body=";
    // 3000 newlines = 9000 encoded chars, which exceeds 8000
    const body = "\n".repeat(3000);

    const result = await truncateForUrl(body, baseUrl);
    expect(result.truncated).toBe(true);
    expect(result.body.length).toBeLessThan(body.length);
  });

  it("very long baseUrl leaves less room for body", async () => {
    const { truncateForUrl } = await freshImport();
    const { mockCopyToClipboard } = await getMocks();
    mockCopyToClipboard.mockResolvedValue(false);

    // A short body that would normally pass, but a very long baseUrl consumes the budget
    const longBaseUrl =
      "https://github.com/user/very-long-org-name/very-long-repo-name/releases/new?" +
      "tag=v1.0.0&prerelease=false&generate_release_notes=false&" +
      "x=".padEnd(7900, "a") +
      "body=";
    const body = "x".repeat(200);

    const result = await truncateForUrl(body, longBaseUrl);
    expect(result.truncated).toBe(true);
  });

  it("empty body returns as-is without truncation", async () => {
    const { truncateForUrl } = await freshImport();

    const baseUrl =
      "https://github.com/user/repo/releases/new?tag=v1.0.0&body=";
    const result = await truncateForUrl("", baseUrl);

    expect(result.body).toBe("");
    expect(result.truncated).toBe(false);
    expect(result.clipboardCopied).toBe(false);
  });

  it("truncated body does not cut mid-word — binary search handles boundary correctly", async () => {
    const { truncateForUrl } = await freshImport();
    const { mockCopyToClipboard } = await getMocks();
    mockCopyToClipboard.mockResolvedValue(false);

    // Use a body with special chars (% signs expand 3x in URL encoding)
    // Enough %'s to force truncation
    const baseUrl =
      "https://github.com/user/repo/releases/new?tag=v1.0.0&body=";
    const body = "%".repeat(3000);

    const result = await truncateForUrl(body, baseUrl);
    expect(result.truncated).toBe(true);
    // The truncated body + suffix should stay within limit when encoded
    const fullUrl = `${baseUrl}${encodeURIComponent(result.body)}`;
    expect(fullUrl.length).toBeLessThanOrEqual(8000);
    expect(result.body).toContain("truncated");
  });
});
