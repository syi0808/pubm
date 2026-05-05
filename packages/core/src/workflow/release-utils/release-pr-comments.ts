import type { ReleasePrScope } from "./scope.js";

export const RELEASE_PR_DRY_RUN_COMMENT_MARKER =
  "<!-- pubm:release-pr-dry-run -->";

export interface ReleasePrDryRunPassedCommentInput {
  scope: Pick<ReleasePrScope, "displayName"> | string;
  runUrl?: string;
}

export function renderReleasePrDryRunPassedComment(
  input: ReleasePrDryRunPassedCommentInput,
): string {
  const scope =
    typeof input.scope === "string" ? input.scope : input.scope.displayName;
  const lines = [
    RELEASE_PR_DRY_RUN_COMMENT_MARKER,
    "### release and publish dry-run passed",
    "",
    `Scope: \`${scope}\``,
  ];

  if (input.runUrl) {
    lines.push("", `CI run: [View workflow run](${input.runUrl})`);
  }

  return lines.join("\n");
}
