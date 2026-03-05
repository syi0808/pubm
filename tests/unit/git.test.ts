import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tinyexec", () => ({
  exec: vi.fn(),
}));

import { exec } from "tinyexec";
import { Git } from "../../src/git.js";

const mockedExec = vi.mocked(exec);

let git: Git;

beforeEach(() => {
  vi.clearAllMocks();
  git = new Git();
});

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}


describe("Git", () => {
  describe("git(args)", () => {
    it("returns stdout on success", async () => {
      mockStdout("output");

      const result = await git.git(["status"]);

      expect(mockedExec).toHaveBeenCalledWith("git", ["status"], { throwOnError: true });
      expect(result).toBe("output");
    });

    it("does not throw when command succeeds with stderr output", async () => {
      mockedExec.mockResolvedValue({ stdout: "output", stderr: "warning: something" } as any);

      const result = await git.git(["status"]);

      expect(result).toBe("output");
    });

    it("throws when exec fails", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: something"));

      await expect(git.git(["status"])).rejects.toThrow("fatal: something");
    });
  });

  describe("userName()", () => {
    it("returns trimmed user name", async () => {
      mockStdout("John Doe\n");

      const result = await git.userName();

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "config",
        "--get",
        "user.name",
      ], { throwOnError: true });
      expect(result).toBe("John Doe");
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      await expect(git.userName()).rejects.toThrow(
        "Failed to run `git config --get user.name`",
      );
    });
  });

  describe("latestTag()", () => {
    it("returns trimmed tag on success", async () => {
      mockStdout("v1.2.3\n");

      const result = await git.latestTag();

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "describe",
        "--tags",
        "--abbrev=0",
      ], { throwOnError: true });
      expect(result).toBe("v1.2.3");
    });

    it("returns null when no tags exist (catch returns null)", async () => {
      mockedExec.mockRejectedValue(new Error("no tags"));

      const result = await git.latestTag();

      expect(result).toBeNull();
    });
  });

  describe("tags()", () => {
    it("returns sorted list with v prefix stripped", async () => {
      mockStdout("v1.0.0\nv2.0.0\nv1.1.0\n");

      const result = await git.tags();

      expect(mockedExec).toHaveBeenCalledWith("git", ["tag", "-l"], { throwOnError: true });
      expect(result).toEqual(["1.0.0", "1.1.0", "2.0.0"]);
    });

    it("handles single tag", async () => {
      mockStdout("v1.0.0\n");

      const result = await git.tags();

      expect(result).toEqual(["1.0.0"]);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      await expect(git.tags()).rejects.toThrow("Failed to run");
    });
  });

  describe("previousTag(tag)", () => {
    it("returns the tag before the given tag", async () => {
      mockStdout("v1.0.0\nv2.0.0\nv3.0.0\n");

      const result = await git.previousTag("2.0.0");

      expect(result).toBe("1.0.0");
    });

    it("returns the last tag when given tag is the first (wraps around with at(-1))", async () => {
      mockStdout("v1.0.0\nv2.0.0\nv3.0.0\n");

      const result = await git.previousTag("1.0.0");

      // at(findIndex(0) - 1) = at(-1) = last element
      expect(result).toBe("3.0.0");
    });

    it("returns a tag via wrap-around when tag is not found", async () => {
      mockStdout("v1.0.0\nv2.0.0\n");

      const result = await git.previousTag("9.9.9");

      // findIndex returns -1, at(-1 - 1) = at(-2), which wraps to index 0
      expect(result).toBe("1.0.0");
    });

    it("returns null when tag list has only one element and tag is not found", async () => {
      mockStdout("v1.0.0\n");

      const result = await git.previousTag("9.9.9");

      // findIndex returns -1, at(-2) on a 1-element array returns undefined -> null
      expect(result).toBeNull();
    });

    it("returns null on error (catch returns null)", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      const result = await git.previousTag("1.0.0");

      expect(result).toBeNull();
    });
  });

  describe("dryFetch()", () => {
    it("returns fetch output on success", async () => {
      mockStdout("From https://github.com/user/repo\n");

      const result = await git.dryFetch();

      expect(mockedExec).toHaveBeenCalledWith("git", ["fetch", "--dry-run"], { throwOnError: true });
      expect(result).toBe("From https://github.com/user/repo\n");
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: unable to access"));

      await expect(git.dryFetch()).rejects.toThrow(
        "Failed to run `git fetch --dry-run`",
      );
    });
  });

  describe("fetch()", () => {
    it("returns true on success", async () => {
      mockStdout("");

      const result = await git.fetch();

      expect(mockedExec).toHaveBeenCalledWith("git", ["fetch"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: unable to access"));

      await expect(git.fetch()).rejects.toThrow("Failed to run `git fetch`");
    });
  });

  describe("pull()", () => {
    it("returns true on success", async () => {
      mockStdout("Already up to date.");

      const result = await git.pull();

      expect(mockedExec).toHaveBeenCalledWith("git", ["pull"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: Not possible to fast-forward"));

      await expect(git.pull()).rejects.toThrow("Failed to run `git pull`");
    });
  });

  describe("revisionDiffsCount()", () => {
    it("returns parsed integer count", async () => {
      mockStdout("5\n");

      const result = await git.revisionDiffsCount();

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "rev-list",
        "@{u}...HEAD",
        "--count",
        "--left-only",
      ], { throwOnError: true });
      expect(result).toBe(5);
    });

    it("returns 0 when no diffs", async () => {
      mockStdout("0\n");

      const result = await git.revisionDiffsCount();

      expect(result).toBe(0);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: no upstream configured"));

      await expect(git.revisionDiffsCount()).rejects.toThrow(
        "Failed to run `git rev-list @{u}...HEAD --count --left-only`",
      );
    });
  });

  describe("status()", () => {
    it("returns trimmed porcelain output", async () => {
      mockStdout(" M src/index.ts\n?? new-file.ts\n");

      const result = await git.status();

      expect(mockedExec).toHaveBeenCalledWith("git", ["status", "--porcelain"], { throwOnError: true });
      expect(result).toBe("M src/index.ts\n?? new-file.ts");
    });

    it("returns empty string for clean working tree", async () => {
      mockStdout("  \n");

      const result = await git.status();

      expect(result).toBe("");
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: not a git repository"));

      await expect(git.status()).rejects.toThrow(
        "Failed to run `git status --porcelain`",
      );
    });
  });

  describe("commits(leftRev, rightRev)", () => {
    it("parses log output into {id, message} objects", async () => {
      const hash1 = "a".repeat(40);
      const hash2 = "b".repeat(40);
      mockStdout(`${hash1} first commit\n${hash2} second commit\n`);

      const result = await git.commits("v1.0.0", "HEAD");

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "log",
        "v1.0.0...HEAD",
        "--format=%H %s",
      ], { throwOnError: true });
      expect(result).toEqual([
        { id: hash1, message: "first commit" },
        { id: hash2, message: "second commit" },
      ]);
    });

    it("returns empty array when there are no commits", async () => {
      mockStdout("");

      const result = await git.commits("v1.0.0", "v1.0.0");

      expect(result).toEqual([]);
    });

    it("filters out empty lines via flatMap", async () => {
      const hash = "c".repeat(40);
      mockStdout(`${hash} commit message\n\n`);

      const result = await git.commits("v1.0.0", "HEAD");

      expect(result).toEqual([{ id: hash, message: "commit message" }]);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: bad revision"));

      await expect(git.commits("bad", "HEAD")).rejects.toThrow(
        "Failed to run `git log bad...HEAD --format='%H %s'`",
      );
    });
  });

  describe("version()", () => {
    it("extracts semver from git version output", async () => {
      mockStdout("git version 2.39.0\n");

      const result = await git.version();

      expect(mockedExec).toHaveBeenCalledWith("git", ["--version"], { throwOnError: true });
      expect(result).toBe("2.39.0");
    });

    it('returns "undefined" string when no semver found', async () => {
      mockStdout("git version unknown\n");

      const result = await git.version();

      // match returns null, ?.[0] is undefined, template literal stringifies it
      expect(result).toBe("undefined");
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      await expect(git.version()).rejects.toThrow(
        "Failed to run `git --version`",
      );
    });
  });

  describe("branch()", () => {
    it("returns current branch name", async () => {
      mockStdout("main\n");

      const result = await git.branch();

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ], { throwOnError: true });
      expect(result).toBe("main");
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: not a git repository"));

      await expect(git.branch()).rejects.toThrow(
        "Failed to run `git rev-parse --abbrev-ref HEAD`",
      );
    });
  });

  describe("switch(branch)", () => {
    it("returns true on success", async () => {
      mockStdout("");

      const result = await git.switch("develop");

      expect(mockedExec).toHaveBeenCalledWith("git", ["switch", "develop"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: invalid reference"));

      await expect(git.switch("nonexistent")).rejects.toThrow(
        "Failed to run `git switch nonexistent`",
      );
    });
  });

  describe("checkTagExist(tag)", () => {
    it("returns true when tag exists (non-empty output)", async () => {
      mockStdout("abc123\n");

      const result = await git.checkTagExist("v1.0.0");

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "rev-parse",
        "-q",
        "--verify",
        "refs/tags/v1.0.0",
      ], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("returns false when output is empty", async () => {
      mockStdout("  \n");

      const result = await git.checkTagExist("v1.0.0");

      expect(result).toBe(false);
    });

    it("returns false on error", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      const result = await git.checkTagExist("v1.0.0");

      expect(result).toBe(false);
    });
  });

  describe("deleteTag(tag)", () => {
    it("returns true on success", async () => {
      mockStdout("Deleted tag 'v1.0.0'");

      const result = await git.deleteTag("v1.0.0");

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "tag",
        "--delete",
        "v1.0.0",
      ], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("error: tag not found"));

      await expect(git.deleteTag("v9.9.9")).rejects.toThrow(
        "Failed to run `git tag --delete v9.9.9`",
      );
    });
  });

  describe("stageAll()", () => {
    it("returns true on success", async () => {
      mockStdout("");

      const result = await git.stageAll();

      expect(mockedExec).toHaveBeenCalledWith("git", ["add", "."], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: not a git repository"));

      await expect(git.stageAll()).rejects.toThrow("Failed to run `git add .`");
    });
  });

  describe("stash()", () => {
    it("returns true on success", async () => {
      mockStdout("Saved working directory");

      const result = await git.stash();

      expect(mockedExec).toHaveBeenCalledWith("git", ["stash"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("error"));

      await expect(git.stash()).rejects.toThrow("Failed to run `git stash`");
    });
  });

  describe("popStash()", () => {
    it("returns true on success", async () => {
      mockStdout("");

      const result = await git.popStash();

      expect(mockedExec).toHaveBeenCalledWith("git", ["stash", "pop"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("error: no stash entries"));

      await expect(git.popStash()).rejects.toThrow(
        "Failed to run `git stash pop`",
      );
    });
  });

  describe("stage(file)", () => {
    it("returns true on success", async () => {
      mockStdout("");

      const result = await git.stage("src/index.ts");

      expect(mockedExec).toHaveBeenCalledWith("git", ["add", "src/index.ts"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: pathspec not found"));

      await expect(git.stage("nonexistent.ts")).rejects.toThrow(
        "Failed to run `git add nonexistent.ts`",
      );
    });
  });

  describe("reset(rev?, option?)", () => {
    it("returns true with both rev and option", async () => {
      mockStdout("");

      const result = await git.reset("HEAD~1", "--hard");

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "reset",
        "HEAD~1",
        "--hard",
      ], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("returns true with only rev", async () => {
      mockStdout("");

      const result = await git.reset("HEAD~1");

      expect(mockedExec).toHaveBeenCalledWith("git", ["reset", "HEAD~1"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("returns true with no arguments (filters undefined)", async () => {
      mockStdout("");

      const result = await git.reset();

      expect(mockedExec).toHaveBeenCalledWith("git", ["reset"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("filters undefined option but keeps rev", async () => {
      mockStdout("");

      await git.reset("HEAD~1", undefined);

      expect(mockedExec).toHaveBeenCalledWith("git", ["reset", "HEAD~1"], { throwOnError: true });
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: ambiguous argument"));

      await expect(git.reset("bad-ref", "--hard")).rejects.toThrow(
        "Failed to run `git reset bad-ref --hard`",
      );
    });
  });

  describe("latestCommit()", () => {
    it("returns trimmed HEAD hash", async () => {
      const hash = "a".repeat(40);
      mockStdout(`${hash}\n`);

      const result = await git.latestCommit();

      expect(mockedExec).toHaveBeenCalledWith("git", ["rev-parse", "HEAD"], { throwOnError: true });
      expect(result).toBe(hash);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: not a git repository"));

      await expect(git.latestCommit()).rejects.toThrow(
        "Failed to run `git rev-parse HEAD`",
      );
    });
  });

  describe("firstCommit()", () => {
    it("returns trimmed first commit hash", async () => {
      const hash = "f".repeat(40);
      mockStdout(`${hash}\n`);

      const result = await git.firstCommit();

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "rev-list",
        "--max-parents=0",
        "HEAD",
      ], { throwOnError: true });
      expect(result).toBe(hash);
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: bad default revision"));

      await expect(git.firstCommit()).rejects.toThrow(
        "Failed to run `git rev-list --max-parents=0 HEAD`",
      );
    });
  });

  describe("commit(message)", () => {
    it("commits and returns the latest commit hash", async () => {
      const hash = "d".repeat(40);
      // First call: git commit -m message
      // Second call: git rev-parse HEAD (latestCommit)
      mockedExec
        .mockResolvedValueOnce({ stdout: "", stderr: "" } as any)
        .mockResolvedValueOnce({
          stdout: `${hash}\n`,
          stderr: "",
        } as any);

      const result = await git.commit("fix: something");

      expect(mockedExec).toHaveBeenNthCalledWith(1, "git", [
        "commit",
        "-m",
        "fix: something",
      ], { throwOnError: true });
      expect(mockedExec).toHaveBeenNthCalledWith(2, "git", [
        "rev-parse",
        "HEAD",
      ], { throwOnError: true });
      expect(result).toBe(hash);
    });

    it("throws GitError when commit fails", async () => {
      mockedExec.mockRejectedValue(new Error("error: nothing to commit"));

      await expect(git.commit("test")).rejects.toThrow(
        "Failed to run `git commit -m test`",
      );
    });
  });

  describe("repository()", () => {
    it("returns trimmed remote URL", async () => {
      mockStdout("https://github.com/user/repo.git\n");

      const result = await git.repository();

      expect(mockedExec).toHaveBeenCalledWith("git", [
        "remote",
        "get-url",
        "origin",
      ], { throwOnError: true });
      expect(result).toBe("https://github.com/user/repo.git");
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: No such remote"));

      await expect(git.repository()).rejects.toThrow(
        "Failed to run `git remote get-url origin`",
      );
    });
  });

  describe("createTag(tag, commitRev?)", () => {
    it("returns true when creating tag without commitRev", async () => {
      mockStdout("");

      const result = await git.createTag("v1.0.0");

      expect(mockedExec).toHaveBeenCalledWith("git", ["tag", "v1.0.0"], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("returns true when creating tag with commitRev", async () => {
      const hash = "e".repeat(40);
      mockStdout("");

      const result = await git.createTag("v1.0.0", hash);

      expect(mockedExec).toHaveBeenCalledWith("git", ["tag", "v1.0.0", hash], { throwOnError: true });
      expect(result).toBe(true);
    });

    it("filters undefined commitRev from args", async () => {
      mockStdout("");

      await git.createTag("v1.0.0", undefined);

      expect(mockedExec).toHaveBeenCalledWith("git", ["tag", "v1.0.0"], { throwOnError: true });
    });

    it("throws GitError on failure", async () => {
      mockedExec.mockRejectedValue(new Error("fatal: tag already exists"));

      await expect(git.createTag("v1.0.0")).rejects.toThrow(
        "Failed to run `git tag v1.0.0`",
      );
    });
  });

  describe("push(options?)", () => {
    it("returns true on successful push without options", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      const result = await git.push();

      expect(mockedExec).toHaveBeenCalledWith("git", ["push"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("returns true on successful push with options", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      const result = await git.push("--tags");

      expect(mockedExec).toHaveBeenCalledWith("git", ["push", "--tags"], {
        throwOnError: true,
      });
      expect(result).toBe(true);
    });

    it("returns false when stderr contains GH006 (try block)", async () => {
      mockedExec.mockResolvedValue({
        stdout: "",
        stderr: "remote: error: GH006: Protected branch update failed",
      } as any);

      const result = await git.push();

      expect(result).toBe(false);
    });

    it("returns false when error contains GH006 (catch block)", async () => {
      mockedExec.mockRejectedValue(
        new Error("remote: error: GH006: Protected branch update failed"),
      );

      const result = await git.push();

      expect(result).toBe(false);
    });

    it("throws GitError for non-GH006 errors", async () => {
      mockedExec.mockRejectedValue(new Error("Permission denied"));

      await expect(git.push()).rejects.toThrow("Failed to run `git push`");
    });

    it("throws GitError for non-GH006 errors with options", async () => {
      mockedExec.mockRejectedValue(new Error("Permission denied"));

      await expect(git.push("--tags")).rejects.toThrow(
        "Failed to run `git push --tags`",
      );
    });

    it("filters undefined options from args", async () => {
      mockedExec.mockResolvedValue({ stdout: "", stderr: "" } as any);

      await git.push(undefined);

      expect(mockedExec).toHaveBeenCalledWith("git", ["push"], {
        throwOnError: true,
      });
    });
  });
});
