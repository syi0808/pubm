import { t } from "../../i18n/index.js";
import type { ReleaseOperation } from "../release-operation.js";
import {
  prepareVersionMaterialization,
  writeReleaseFiles,
} from "./materialize.js";
import {
  commitReleaseFiles,
  createLocalReleaseTags,
  ensureReleaseTagsAvailable,
} from "./tags.js";

export function createVersionOperation(
  hasPrepare: boolean,
  dryRun: boolean,
): ReleaseOperation {
  return {
    title: t("task.version.title"),
    enabled: hasPrepare,
    run: async (ctx, task): Promise<void> => {
      const prepared = await prepareVersionMaterialization(ctx, task);
      await writeReleaseFiles(ctx, task, prepared, { dryRun });

      if (dryRun) return;

      await ensureReleaseTagsAvailable(ctx, task, prepared.tagReferences);
      const commit = await commitReleaseFiles(
        ctx,
        task,
        prepared.versionMap,
        prepared.tagReferences,
      );
      await createLocalReleaseTags(ctx, task, commit, prepared.tagReferences);
    },
  };
}
