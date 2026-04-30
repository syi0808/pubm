import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Changeset } from "../../changeset/parser.js";
import type { PubmContext } from "../../context.js";
import { ecosystemCatalog } from "../../ecosystem/catalog.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import { pathFromKey } from "../../utils/package-key.js";
import {
  formatWorkflowReleaseTag,
  isWorkflowReleaseExcluded,
  workflowPackageNameForKey,
} from "../version-step-output.js";

export function isReleaseExcluded(
  config: { excludeRelease?: string[] },
  pkgPath: string,
): boolean {
  return isWorkflowReleaseExcluded(config, pkgPath);
}

export function getPackageName(ctx: PubmContext, key: string): string {
  return workflowPackageNameForKey(ctx, key);
}

export function formatTag(
  ctx: PubmContext,
  key: string,
  version: string,
): string {
  return formatWorkflowReleaseTag(ctx, key, version);
}

export function requireVersionPlan(ctx: PubmContext) {
  const { versionPlan } = ctx.runtime;
  if (!versionPlan) {
    throw new Error("Version plan is required before running release tasks.");
  }

  return versionPlan;
}

/** Back up manifest files and register rollback to restore them. */
export function registerManifestBackups(ctx: PubmContext): void {
  for (const pkg of ctx.config.packages) {
    const absPath = path.resolve(ctx.cwd, pkg.path);
    const descriptor = ecosystemCatalog.get(pkg.ecosystem);
    if (!descriptor) continue;
    const eco = new descriptor.ecosystemClass(absPath);
    for (const manifestFile of eco.manifestFiles()) {
      const manifestPath = path.resolve(absPath, manifestFile);
      if (existsSync(manifestPath)) {
        const backup = readFileSync(manifestPath, "utf-8");
        ctx.runtime.rollback.add({
          label: `Restore ${path.relative(ctx.cwd, manifestPath)}`,
          fn: async () => {
            writeFileSync(manifestPath, backup, "utf-8");
          },
        });
      }
    }
  }
}

/** Back up changeset files and register rollback to restore them. */
export function registerChangesetBackups(
  ctx: PubmContext,
  changesets: Changeset[],
): void {
  const changesetsDir = path.join(ctx.cwd, ".pubm", "changesets");
  const changesetBackups = new Map<string, string>();
  for (const changeset of changesets) {
    const filePath = path.join(changesetsDir, `${changeset.id}.md`);
    if (existsSync(filePath)) {
      changesetBackups.set(filePath, readFileSync(filePath, "utf-8"));
    }
  }
  if (changesetBackups.size > 0) {
    ctx.runtime.rollback.add({
      label: `Restore ${changesetBackups.size} changeset file(s)`,
      fn: async () => {
        for (const [fp, content] of changesetBackups) {
          writeFileSync(fp, content, "utf-8");
        }
      },
    });
  }
}

/** Back up changelog file and register rollback to restore it. */
export function registerChangelogBackup(
  ctx: PubmContext,
  changelogPath: string,
): void {
  if (existsSync(changelogPath)) {
    const changelogBackup = readFileSync(changelogPath, "utf-8");
    ctx.runtime.rollback.add({
      label: `Restore ${path.relative(ctx.cwd, changelogPath)}`,
      fn: async () => {
        writeFileSync(changelogPath, changelogBackup, "utf-8");
      },
    });
  }
}

/** Register rollback to reset the most recent git commit. */
export function registerCommitRollback(ctx: PubmContext): void {
  ctx.runtime.rollback.add({
    label: "Reset git commit",
    fn: async () => {
      const g = new Git();
      await g.reset();
      const dirty = (await g.status()) !== "";
      if (dirty) await g.stash();
      await g.reset("HEAD^", "--hard");
      if (dirty) await g.popStash();
    },
  });
}

/** Register rollback to delete a local git tag. */
export function registerTagRollback(ctx: PubmContext, tagName: string): void {
  ctx.runtime.rollback.add({
    label: `Delete local tag ${tagName}`,
    fn: async () => {
      const g = new Git();
      await g.deleteTag(tagName);
    },
  });
}

export function registerRemoteTagRollback(ctx: PubmContext): void {
  const plan = requireVersionPlan(ctx);
  if (plan.mode === "independent") {
    for (const [key, pkgVersion] of plan.packages) {
      if (isReleaseExcluded(ctx.config, pathFromKey(key))) continue;
      const tag = formatTag(ctx, key, pkgVersion);
      ctx.runtime.rollback.add({
        label: t("task.push.deleteRemoteTag", { tag }),
        fn: async () => {
          const g = new Git();
          await g.pushDelete("origin", tag);
        },
      });
    }
  } else {
    const tagName = `v${plan.version}`;
    ctx.runtime.rollback.add({
      label: t("task.push.deleteRemoteTag", { tag: tagName }),
      fn: async () => {
        const g = new Git();
        await g.pushDelete("origin", tagName);
      },
    });
  }
}
