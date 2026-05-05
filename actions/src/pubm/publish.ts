import {
  type PubmContext,
  prepareReleasePrPublish,
  publishReleasePr,
} from "@pubm/core";

export async function publishMergedReleasePr(
  ctx: PubmContext,
  input: { beforeSha: string; afterSha: string },
): Promise<"published" | "no_scope"> {
  const plan = await prepareReleasePrPublish(ctx, input);
  if (!plan) return "no_scope";
  await publishReleasePr(ctx, { plan });
  return "published";
}
