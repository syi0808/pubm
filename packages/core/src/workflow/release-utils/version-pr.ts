import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseChangelogSection } from "../../changeset/changelog-parser.js";
import type { PubmContext, VersionPlan } from "../../context.js";
import { AbstractError } from "../../error.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import {
  closeVersionPr,
  createVersionPr,
} from "../../tasks/create-version-pr.js";
import { buildVersionPrBody } from "../../tasks/version-pr-body.js";
import { packageKey, pathFromKey } from "../../utils/package-key.js";
import { parseOwnerRepo } from "../../utils/parse-owner-repo.js";
import {
  registerRemoteTagRollback,
  requireVersionPlan,
} from "./rollback-handlers.js";

export async function pushViaPr(
  ctx: PubmContext,
  git: Git,
  task: { output: string },
): Promise<void> {
  const branchName = `pubm/version-packages-${Date.now()}`;

  task.output = t("task.push.creatingBranch", { branch: branchName });
  await git.createBranch(branchName);

  task.output = t("task.push.pushingBranch", { branch: branchName });
  await git.pushNewBranch("origin", branchName);

  ctx.runtime.rollback.add({
    label: t("task.push.deleteRemoteBranch", { branch: branchName }),
    fn: async () => {
      const g = new Git();
      await g.pushDelete("origin", branchName);
    },
  });

  registerRemoteTagRollback(ctx);

  const plan = requireVersionPlan(ctx);
  const prBody = buildPrBodyFromContext(ctx, plan);

  const remoteUrl = await git.repository();
  const { owner, repo } = parseOwnerRepo(remoteUrl);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new AbstractError(t("error.githubRelease.tokenRequired"));
  }

  task.output = t("task.push.creatingPr");
  const pr = await createVersionPr({
    branch: branchName,
    base: ctx.config.branch,
    title: "Version Packages",
    body: prBody,
    token,
    owner,
    repo,
    labels: ["no-changeset"],
  });

  task.output = t("task.push.prCreated", { url: pr.url });

  // Rollback executes LIFO — register in reverse order of desired execution
  // Desired: close PR → delete branch → (tags already registered earlier)
  // Branch-delete was registered right after pushNewBranch; register PR-close last so it runs first
  ctx.runtime.rollback.add({
    label: t("task.push.closePr", { number: pr.number }),
    fn: async () => {
      await closeVersionPr({ number: pr.number, token, owner, repo });
    },
  });

  await git.switch(ctx.config.branch);
}

export function buildPrBodyFromContext(
  ctx: PubmContext,
  plan: VersionPlan,
): string {
  const packages: { name: string; version: string; bump: string }[] = [];
  const changelogs = new Map<string, string>();

  if (plan.mode === "independent") {
    for (const [key, pkgVersion] of plan.packages) {
      const pkgConfig = ctx.config.packages.find((p) => packageKey(p) === key);
      const name = pkgConfig?.name ?? pathFromKey(key);
      packages.push({ name, version: pkgVersion, bump: "" });

      const changelogDir = pkgConfig
        ? path.resolve(ctx.cwd, pkgConfig.path)
        : path.resolve(ctx.cwd, pathFromKey(key));
      const changelogPath = path.join(changelogDir, "CHANGELOG.md");
      if (existsSync(changelogPath)) {
        const section = parseChangelogSection(
          readFileSync(changelogPath, "utf-8"),
          pkgVersion,
        );
        if (section) changelogs.set(name, section);
      }
    }
  } else {
    const version = plan.version;
    for (const pkg of ctx.config.packages) {
      packages.push({ name: pkg.name, version, bump: "" });
    }

    if (plan.mode === "single") {
      const changelogPath = path.join(ctx.cwd, "CHANGELOG.md");
      if (existsSync(changelogPath)) {
        const section = parseChangelogSection(
          readFileSync(changelogPath, "utf-8"),
          version,
        );
        if (section) changelogs.set(packages[0]?.name ?? "", section);
      }
    } else {
      for (const pkg of ctx.config.packages) {
        const changelogPath = path.join(ctx.cwd, pkg.path, "CHANGELOG.md");
        if (existsSync(changelogPath)) {
          const section = parseChangelogSection(
            readFileSync(changelogPath, "utf-8"),
            version,
          );
          if (section) changelogs.set(pkg.name, section);
        }
      }
    }
  }

  return buildVersionPrBody({ packages, changelogs });
}
