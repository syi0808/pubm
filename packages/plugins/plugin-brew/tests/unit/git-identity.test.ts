import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { ensureGitIdentity } from "../../src/git-identity.js";

const mockedExecSync = vi.mocked(execSync);

describe("ensureGitIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only checks existing git identity when already configured", () => {
    mockedExecSync.mockImplementation((command) => {
      if (
        command === "git config user.name" ||
        command === "git config user.email"
      ) {
        return Buffer.from("configured");
      }

      throw new Error(`Unexpected command: ${command}`);
    });

    ensureGitIdentity();

    expect(mockedExecSync).toHaveBeenNthCalledWith(1, "git config user.name", {
      encoding: "utf-8",
      stdio: "pipe",
    });
    expect(mockedExecSync).toHaveBeenNthCalledWith(2, "git config user.email", {
      encoding: "utf-8",
      stdio: "pipe",
    });
    expect(mockedExecSync).toHaveBeenCalledTimes(2);
  });

  it("configures fallback identity in the provided cwd", () => {
    mockedExecSync.mockImplementation((command) => {
      if (
        command === "git config user.name" ||
        command === "git config user.email"
      ) {
        throw new Error("missing identity");
      }

      return Buffer.from("");
    });

    ensureGitIdentity("/tmp/pubm-repo");

    expect(mockedExecSync).toHaveBeenNthCalledWith(1, "git config user.name", {
      cwd: "/tmp/pubm-repo",
      encoding: "utf-8",
      stdio: "pipe",
    });
    expect(mockedExecSync).toHaveBeenNthCalledWith(
      2,
      'git config user.name "pubm[bot]"',
      {
        cwd: "/tmp/pubm-repo",
        encoding: "utf-8",
      },
    );
    expect(mockedExecSync).toHaveBeenNthCalledWith(3, "git config user.email", {
      cwd: "/tmp/pubm-repo",
      encoding: "utf-8",
      stdio: "pipe",
    });
    expect(mockedExecSync).toHaveBeenNthCalledWith(
      4,
      'git config user.email "pubm[bot]@users.noreply.github.com"',
      {
        cwd: "/tmp/pubm-repo",
        encoding: "utf-8",
      },
    );
  });
});
