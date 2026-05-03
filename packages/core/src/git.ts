import semver from "semver";
import { AbstractError } from "./error.js";
import { exec } from "./utils/exec.js";

class GitError extends AbstractError {
  name = "Git Error";
}

export function extractVersion(tag: string): string {
  const atIndex = tag.lastIndexOf("@");
  if (atIndex > 0) return tag.slice(atIndex + 1);
  return tag.replace(/^v/, "");
}

export function extractPrefix(tag: string): string {
  const atIndex = tag.lastIndexOf("@");
  if (atIndex > 0) return tag.slice(0, atIndex);
  return tag.startsWith("v") ? "v" : "";
}

export class Git {
  async git(args: string[]): Promise<string> {
    const { stdout } = await exec("git", args, { throwOnError: true });

    return stdout;
  }

  async userName(): Promise<string> {
    try {
      return (await this.git(["config", "--get", "user.name"])).trim();
    } catch (error) {
      throw new GitError("Failed to run `git config --get user.name`", {
        cause: error,
      });
    }
  }

  async latestTag(): Promise<string | null> {
    try {
      return (await this.git(["describe", "--tags", "--abbrev=0"])).trim();
    } catch {
      return null;
    }
  }

  async tags(): Promise<string[]> {
    try {
      const raw = (await this.git(["tag", "-l"]))
        .trim()
        .split("\n")
        .filter(Boolean);
      return raw.sort((a, b) => {
        const va = extractVersion(a);
        const vb = extractVersion(b);
        try {
          return semver.compare(va, vb);
        } catch {
          return semver.compareIdentifiers(va, vb);
        }
      });
    } catch (error) {
      throw new GitError("Failed to run `git tag -l`", {
        cause: error,
      });
    }
  }

  async previousTag(tag: string): Promise<string | null> {
    try {
      const prefix = extractPrefix(tag);
      const allTags = await this.tags();
      const samePrefixTags = allTags.filter((t) => extractPrefix(t) === prefix);
      const sorted = samePrefixTags.sort((a, b) =>
        semver.compare(extractVersion(a), extractVersion(b)),
      );
      const idx = sorted.indexOf(tag);
      return idx > 0 ? (sorted[idx - 1] ?? null) : null;
    } catch {
      return null;
    }
  }

  async tagsByPackage(packageName: string): Promise<string[]> {
    try {
      const raw = (await this.git(["tag", "-l", `${packageName}@*`]))
        .trim()
        .split("\n")
        .filter(Boolean);
      return raw;
    } catch {
      return [];
    }
  }

  async latestTagForPackage(packageName: string): Promise<string | null> {
    const tags = await this.tagsByPackage(packageName);
    if (tags.length === 0) return null;
    const sorted = tags.sort((a, b) => {
      const va = a.slice(packageName.length + 1);
      const vb = b.slice(packageName.length + 1);
      return semver.compare(va, vb);
    });
    return sorted[sorted.length - 1] ?? null;
  }

  async dryFetch(): Promise<string> {
    try {
      return await this.git(["fetch", "--dry-run"]);
    } catch (error) {
      throw new GitError("Failed to run `git fetch --dry-run`", {
        cause: error,
      });
    }
  }

  async fetch(): Promise<boolean> {
    try {
      await this.git(["fetch"]);

      return true;
    } catch (error) {
      throw new GitError("Failed to run `git fetch`", {
        cause: error,
      });
    }
  }

  async pull(): Promise<boolean> {
    try {
      await this.git(["pull"]);

      return true;
    } catch (error) {
      throw new GitError("Failed to run `git pull`", {
        cause: error,
      });
    }
  }

  async revisionDiffsCount(): Promise<number> {
    try {
      return Number.parseInt(
        await this.git(["rev-list", "@{u}...HEAD", "--count", "--left-only"]),
        10,
      );
    } catch (error) {
      throw new GitError(
        "Failed to run `git rev-list @{u}...HEAD --count --left-only`",
        { cause: error },
      );
    }
  }

  async status(): Promise<string> {
    try {
      return (await this.git(["status", "--porcelain"])).trim();
    } catch (error) {
      throw new GitError("Failed to run `git status --porcelain`", {
        cause: error,
      });
    }
  }

  async commits(
    leftRev: string,
    rightRev: string,
  ): Promise<{ id: string; message: string }[]> {
    try {
      const logs = await this.git([
        "log",
        `${leftRev}...${rightRev}`,
        "--format=%H %s",
      ]);

      return logs
        .split("\n")
        .flatMap((log) =>
          log ? [{ id: log.slice(0, 40), message: log.slice(41) }] : [],
        );
    } catch (error) {
      throw new GitError(
        `Failed to run \`git log ${leftRev}...${rightRev} --format='%H %s'\``,
        {
          cause: error,
        },
      );
    }
  }

  async version(): Promise<string> {
    try {
      return `${(await this.git(["--version"])).trim().match(/\d+\.\d+\.\d+/)?.[0]}`;
    } catch (error) {
      throw new GitError("Failed to run `git --version`", {
        cause: error,
      });
    }
  }

  async branch(): Promise<string> {
    try {
      return (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    } catch (error) {
      throw new GitError("Failed to run `git rev-parse --abbrev-ref HEAD`", {
        cause: error,
      });
    }
  }

  async switch(branch: string): Promise<boolean> {
    try {
      await this.git(["switch", branch]);

      return true;
    } catch (error) {
      throw new GitError(`Failed to run \`git switch ${branch}\``, {
        cause: error,
      });
    }
  }

  async checkTagExist(tag: string): Promise<boolean> {
    try {
      return (
        (
          await this.git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`])
        ).trim() !== ""
      );
    } catch {
      return false;
    }
  }

  async deleteTag(tag: string): Promise<boolean> {
    try {
      await this.git(["tag", "--delete", tag]);

      return true;
    } catch (error) {
      throw new GitError(`Failed to run \`git tag --delete ${tag}\``, {
        cause: error,
      });
    }
  }

  async stageAll(): Promise<boolean> {
    try {
      await this.git(["add", "."]);

      return true;
    } catch (error) {
      throw new GitError("Failed to run `git add .`", {
        cause: error,
      });
    }
  }

  async stash(): Promise<boolean> {
    try {
      await this.git(["stash"]);

      return true;
    } catch (error) {
      throw new GitError("Failed to run `git stash`", {
        cause: error,
      });
    }
  }

  async popStash(): Promise<boolean> {
    try {
      await this.git(["stash", "pop"]);

      return true;
    } catch (error) {
      throw new GitError("Failed to run `git stash pop`", {
        cause: error,
      });
    }
  }

  async stage(file: string): Promise<boolean> {
    try {
      await this.git(["add", file]);

      return true;
    } catch (error) {
      throw new GitError(`Failed to run \`git add ${file}\``, {
        cause: error,
      });
    }
  }

  async reset(rev?: string, option?: string): Promise<boolean> {
    const args = ["reset", rev, option].filter((v) => v) as string[];

    try {
      await this.git(args);

      return true;
    } catch (error) {
      throw new GitError(`Failed to run \`git ${args.join(" ")}\``, {
        cause: error,
      });
    }
  }

  async latestCommit(): Promise<string> {
    try {
      return (await this.git(["rev-parse", "HEAD"])).trim();
    } catch (error) {
      throw new GitError("Failed to run `git rev-parse HEAD`", {
        cause: error,
      });
    }
  }

  async firstCommit(): Promise<string> {
    try {
      return (await this.git(["rev-list", "--max-parents=0", "HEAD"])).trim();
    } catch (error) {
      throw new GitError("Failed to run `git rev-list --max-parents=0 HEAD`", {
        cause: error,
      });
    }
  }

  async commit(message: string): Promise<string> {
    try {
      await this.git(["commit", "-m", message]);

      return await this.latestCommit();
    } catch (error) {
      throw new GitError(`Failed to run \`git commit -m ${message}\``, {
        cause: error,
      });
    }
  }

  async repository(): Promise<string> {
    try {
      return (await this.git(["remote", "get-url", "origin"])).trim();
    } catch (error) {
      throw new GitError("Failed to run `git remote get-url origin`", {
        cause: error,
      });
    }
  }

  async createTag(tag: string, commitRev?: string): Promise<boolean> {
    const args = ["tag", "-a", tag, "-m", tag, commitRev].filter(
      (v) => v,
    ) as string[];

    try {
      await this.git(args);

      return true;
    } catch (error) {
      throw new GitError(`Failed to run \`git ${args.join(" ")}\``, {
        cause: error,
      });
    }
  }

  async revParse(rev: string): Promise<string> {
    try {
      return (await this.git(["rev-parse", rev])).trim();
    } catch (error) {
      throw new GitError(`Failed to run \`git rev-parse ${rev}\``, {
        cause: error,
      });
    }
  }

  async pushDelete(remote: string, ref: string): Promise<void> {
    try {
      await this.git(["push", remote, "--delete", ref]);
    } catch (error) {
      throw new GitError(
        `Failed to run \`git push ${remote} --delete ${ref}\``,
        { cause: error },
      );
    }
  }

  async forcePush(remote: string, refspec: string): Promise<void> {
    try {
      await this.git(["push", "-f", remote, refspec]);
    } catch (error) {
      throw new GitError(`Failed to run \`git push -f ${remote} ${refspec}\``, {
        cause: error,
      });
    }
  }

  async createBranch(name: string): Promise<void> {
    try {
      await this.git(["checkout", "-b", name]);
    } catch (error) {
      throw new GitError(`Failed to run \`git checkout -b ${name}\``, {
        cause: error,
      });
    }
  }

  async pushNewBranch(remote: string, branch: string): Promise<void> {
    try {
      await this.git(["push", "-u", remote, branch, "--follow-tags"]);
    } catch (error) {
      throw new GitError(
        `Failed to run \`git push -u ${remote} ${branch} --follow-tags\``,
        { cause: error },
      );
    }
  }

  async deleteBranch(name: string): Promise<void> {
    try {
      await this.git(["branch", "-D", name]);
    } catch (error) {
      throw new GitError(`Failed to run \`git branch -D ${name}\``, {
        cause: error,
      });
    }
  }

  async push(...options: Array<string | undefined>): Promise<boolean> {
    const args = ["push", ...options].filter((v) => v) as string[];

    try {
      const { stderr } = await exec("git", args, { throwOnError: true });

      if (`${stderr}`.includes("GH006")) {
        return false;
      }

      return true;
    } catch (error) {
      if (`${error}`.includes("GH006")) {
        return false;
      }

      throw new GitError(`Failed to run \`git ${args.join(" ")}\``, {
        cause: error,
      });
    }
  }
}
