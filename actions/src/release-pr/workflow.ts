import {
  parseReleasePrBodyMetadata,
  type ReleasePrScope,
  sameReleasePrScope,
} from "@pubm/core";
import type { PlannedReleasePrScope } from "../pubm/release-pr.js";

export const RELEASE_PR_EVENTS = [
  "push",
  "workflow_dispatch",
  "issue_comment",
] as const;

export type ReleasePrEventName = (typeof RELEASE_PR_EVENTS)[number];

export function isReleasePrEvent(
  eventName: string,
): eventName is ReleasePrEventName {
  return (RELEASE_PR_EVENTS as readonly string[]).includes(eventName);
}

export function isPubmSlashCommand(body: string | undefined): boolean {
  return (
    body?.split(/\r?\n/).some((line) => /^\/pubm\s+/i.test(line.trim())) ??
    false
  );
}

export function isAuthorizedRepositoryPermission(
  permission: string | undefined,
): boolean {
  return (
    permission === "write" ||
    permission === "maintain" ||
    permission === "admin"
  );
}

export function selectIssueCommentScope(
  planned: readonly PlannedReleasePrScope[],
  headBranch: string,
  body?: string | null,
): PlannedReleasePrScope | undefined {
  const metadata = parseReleasePrBodyMetadata(body);
  const metadataMatch = planned.find((item) =>
    sameReleasePrScope(item.scope, metadata),
  );
  if (metadataMatch) return metadataMatch;

  const exact = planned.find((item) => item.branchName === headBranch);
  if (exact) return exact;
  if (planned.length === 1) return planned[0];
  return planned.find((item) => headBranch.includes(item.scope.slug));
}

export interface OpenReleasePullRequest {
  number: number;
  body?: string | null;
  head?: {
    ref?: string | null;
    repo?: { full_name?: string | null } | null;
  } | null;
}

export function selectExistingReleasePrForScope(
  planned: PlannedReleasePrScope,
  openPrs: readonly OpenReleasePullRequest[],
): OpenReleasePullRequest | undefined {
  const matches = openPrs.filter((pr) => {
    const metadata = parseReleasePrBodyMetadata(pr.body);
    if (sameReleasePrScope(planned.scope, metadata)) {
      return true;
    }

    return (
      metadata.isReleasePr &&
      Boolean(pr.head?.ref) &&
      (pr.head?.ref === planned.branchName ||
        pr.head?.ref?.includes(planned.scope.slug))
    );
  });

  if (matches.length > 1) {
    throw new Error(
      `Multiple open pubm release PRs match ${scopeLabel(planned.scope)}: ${matches
        .map((pr) => `#${pr.number}`)
        .join(", ")}`,
    );
  }

  return matches[0];
}

export function sameRepoHeadBranch(
  pr: OpenReleasePullRequest | undefined,
  fullName: string,
): string | undefined {
  if (!pr?.head?.ref) return undefined;
  if (pr.head.repo?.full_name !== fullName) return undefined;
  return pr.head.ref;
}

export function formatOverrideErrors(
  errors: readonly { command?: string; message: string }[],
): string {
  return errors
    .map((error) =>
      error.command ? `${error.command}: ${error.message}` : error.message,
    )
    .join("\n");
}

export const RELEASE_PR_COMMAND_MARKER = "<!-- pubm:release-pr-command -->";
export const RELEASE_PR_DRY_RUN_MARKER = "<!-- pubm:release-pr-dry-run -->";

function scopeLabel(scope: ReleasePrScope): string {
  return `${scope.displayName} (${scope.id})`;
}

export function unauthorizedCommandBody(username: string): string {
  return `${RELEASE_PR_COMMAND_MARKER}
### pubm release command ignored

\`${username}\` does not have repository write permission. Release commands require write, maintain, or admin access.`;
}

export function dryRunCommentBody(input: {
  scope: string;
  status: "success" | "failure";
  message?: string;
}): string {
  const heading =
    input.status === "success"
      ? "pubm release dry-run passed"
      : "pubm release dry-run failed";
  const details = input.message
    ? `\n\n\`\`\`text\n${input.message.trim()}\n\`\`\``
    : "";
  return `${RELEASE_PR_DRY_RUN_MARKER}
### ${heading}

Scope: \`${input.scope}\`${details}`;
}
