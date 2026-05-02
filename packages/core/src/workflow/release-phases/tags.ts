import type { PubmContext } from "../../context.js";
import { AbstractError } from "../../error.js";
import { Git } from "../../git.js";
import { t } from "../../i18n/index.js";
import type { ReleaseOperationContext } from "../release-operation.js";
import {
  registerCommitRollback,
  registerTagRollback,
} from "../release-utils/rollback-handlers.js";
import {
  type WorkflowVersionTagReference,
  workflowPackageNameForKey,
} from "../version-step-output.js";

export async function ensureReleaseTagsAvailable(
  ctx: PubmContext,
  task: ReleaseOperationContext,
  tagReferences: readonly WorkflowVersionTagReference[],
): Promise<void> {
  const git = new Git();

  for (const reference of tagReferences) {
    const { tagName } = reference;
    if (!(await git.checkTagExist(tagName))) continue;

    if (ctx.runtime.promptEnabled) {
      const deleteTag = await task.prompt().run<boolean>({
        type: "toggle",
        message: t("task.version.tagExists", { tag: tagName }),
        enabled: "Yes",
        disabled: "No",
      });
      if (deleteTag) {
        await git.deleteTag(tagName);
        continue;
      }
      throw new AbstractError(t("error.version.tagExists", { tag: tagName }));
    }

    throw new AbstractError(
      t("error.version.tagExistsManual", { tag: tagName }),
    );
  }
}

export async function commitReleaseFiles(
  ctx: PubmContext,
  task: ReleaseOperationContext,
  versionMap: readonly (readonly [string, string])[],
  tagReferences: readonly WorkflowVersionTagReference[],
): Promise<string> {
  const git = new Git();
  const firstTagName = tagReferences[0]?.tagName;
  task.output = firstTagName
    ? t("task.version.creatingCommit", { tag: firstTagName })
    : t("task.version.creatingCommitGeneric");

  const commit = await git.commit(createReleaseCommitMessage(ctx, versionMap));
  registerCommitRollback(ctx);
  return commit;
}

export async function createLocalReleaseTags(
  ctx: PubmContext,
  task: ReleaseOperationContext,
  commit: string,
  tagReferences: readonly WorkflowVersionTagReference[],
): Promise<void> {
  const git = new Git();
  task.output = t("task.version.creatingTags");
  for (const reference of tagReferences) {
    await git.createTag(reference.tagName, commit);
    registerTagRollback(ctx, reference.tagName);
  }
}

function createReleaseCommitMessage(
  ctx: PubmContext,
  versionMap: readonly (readonly [string, string])[],
): string {
  return `Version Packages\n\n${versionMap
    .map(
      ([key, version]) =>
        `- ${workflowPackageNameForKey(ctx, key)}: ${version}`,
    )
    .join("\n")}`;
}
