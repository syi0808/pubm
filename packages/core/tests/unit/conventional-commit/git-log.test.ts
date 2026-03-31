import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  findLastReleaseRef,
  getCommitsSinceRef,
} from "../../../src/conventional-commit/git-log.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";

const mockedExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findLastReleaseRef", () => {
  it("returns latest semver tag when no packageName", () => {
    mockedExecFileSync.mockReturnValueOnce("v1.2.0\nv1.1.0\nv1.0.0\n");
    const result = findLastReleaseRef("/repo");
    expect(result).toBe("v1.2.0");
  });

  it("prefers scoped tag when packageName is provided", () => {
    mockedExecFileSync.mockReturnValueOnce("core@1.2.0\ncore@1.1.0\n");
    const result = findLastReleaseRef("/repo", "core");
    expect(result).toBe("core@1.2.0");
    expect(mockedExecFileSync).toHaveBeenCalledTimes(1);
  });

  it("falls back to v* tags when scoped tag not found", () => {
    mockedExecFileSync.mockReturnValueOnce("").mockReturnValueOnce("v1.0.0\n");
    const result = findLastReleaseRef("/repo", "core");
    expect(result).toBe("v1.0.0");
  });

  it("falls back to Version Packages commit", () => {
    mockedExecFileSync.mockReturnValueOnce("").mockReturnValueOnce("abc1234\n");
    const result = findLastReleaseRef("/repo");
    expect(result).toBe("abc1234");
  });

  it("returns undefined when no ref found", () => {
    mockedExecFileSync.mockReturnValue("");
    const result = findLastReleaseRef("/repo");
    expect(result).toBeUndefined();
  });
});

describe("getCommitsSinceRef", () => {
  it("returns parsed commits with files", () => {
    mockedExecFileSync.mockReturnValueOnce(
      [
        "COMMIT_START abc1234",
        "feat(core): add feature",
        "",
        "body text",
        "COMMIT_FILES",
        "packages/core/src/index.ts",
        "COMMIT_START def5678",
        "fix: bug fix",
        "COMMIT_FILES",
        "packages/pubm/src/cli.ts",
        "",
      ].join("\n"),
    );
    const result = getCommitsSinceRef("/repo", "v1.0.0");
    expect(result).toEqual([
      {
        hash: "abc1234",
        message: "feat(core): add feature\n\nbody text",
        files: ["packages/core/src/index.ts"],
      },
      {
        hash: "def5678",
        message: "fix: bug fix",
        files: ["packages/pubm/src/cli.ts"],
      },
    ]);
  });

  it("uses full history when ref is undefined", () => {
    mockedExecFileSync.mockReturnValueOnce("");
    getCommitsSinceRef("/repo", undefined);
    const call = mockedExecFileSync.mock.calls[0];
    const args = call[1] as string[];
    expect(args).not.toContain("v1.0.0..HEAD");
  });
});
