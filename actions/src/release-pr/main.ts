import * as core from "@actions/core";
import * as github from "@actions/github";
import type { PubmContext, UnversionedChange } from "@pubm/core";
import { upsertComment } from "../comment.js";
import {
  checkoutReleaseBranch,
  configureGitAuthor,
  forcePushBranch,
} from "../git.js";
import {
  createOrUpdatePullRequest,
  getPullRequest,
  getRepositoryPermission,
  listIssueComments,
  listOpenReleasePullRequests,
  repoContext,
} from "../github.js";
import { loadPubmContextWithVersionPlan } from "../pubm/config.js";
import {
  dryRunReleasePrScope,
  materializeReleasePrScope,
  planReleasePrScopes,
  resolveReleasePrActionOverride,
} from "../pubm/release-pr.js";
import {
  dryRunCommentBody,
  formatOverrideErrors,
  isAuthorizedRepositoryPermission,
  isPubmSlashCommand,
  isReleasePrEvent,
  RELEASE_PR_COMMAND_MARKER,
  RELEASE_PR_DRY_RUN_MARKER,
  sameRepoHeadBranch,
  selectExistingReleasePrForScope,
  selectIssueCommentScope,
  unauthorizedCommandBody,
} from "./workflow.js";

async function run(): Promise<void> {
  const token = core.getInput("token", { required: true });
  const workingDirectory = core.getInput("working-directory") || ".";
  const baseBranch =
    core.getInput("base-branch") ||
    github.context.payload.repository?.default_branch ||
    "main";
  const octokit = github.getOctokit(token);
  const repo = repoContext();

  if (!isReleasePrEvent(github.context.eventName)) {
    core.setOutput("status", "ignored");
    core.info(`Ignoring unsupported event ${github.context.eventName}`);
    return;
  }

  let issueCommentTarget:
    | {
        headBranch: string;
        body?: string | null;
        labels: string[];
        comments: { body: string; createdAt?: string }[];
      }
    | undefined;

  if (github.context.eventName === "issue_comment") {
    const body = github.context.payload.comment?.body ?? "";
    if (!isPubmSlashCommand(body)) {
      core.setOutput("status", "ignored");
      return;
    }
    if (!github.context.payload.issue?.pull_request) {
      core.setOutput("status", "ignored");
      core.info("Ignoring pubm slash command on a non-pull-request issue.");
      return;
    }

    const prNumber = github.context.payload.issue.number;
    const actor =
      github.context.payload.comment?.user?.login ?? github.context.actor;
    const permission = actor
      ? await getRepositoryPermission(octokit, repo, actor)
      : undefined;
    if (!isAuthorizedRepositoryPermission(permission)) {
      await upsertComment(
        octokit,
        { ...repo, issueNumber: prNumber },
        unauthorizedCommandBody(actor ?? "unknown"),
        RELEASE_PR_COMMAND_MARKER,
      );
      core.setOutput("status", "unauthorized");
      core.info(
        `Ignoring pubm slash command from ${actor ?? "unknown"} with permission ${permission ?? "none"}.`,
      );
      return;
    }

    const pr = await getPullRequest(octokit, repo, prNumber);
    if (pr.base.ref !== baseBranch) {
      core.setOutput("status", "ignored");
      core.info(`Ignoring release command for base branch ${pr.base.ref}.`);
      return;
    }

    const comments = await listIssueComments(octokit, repo, prNumber);
    issueCommentTarget = {
      headBranch: pr.head.ref,
      body: pr.body,
      labels: (pr.labels ?? []).map((label) => label.name),
      comments: comments.map((comment) => ({
        body: comment.body ?? "",
        createdAt: comment.created_at,
      })),
    };
  }

  process.env.GITHUB_TOKEN = token;
  const ctx = await loadPubmContextWithVersionPlan({
    workingDirectory,
    baseBranch,
  });
  const pullRequest = ctx.config.release.pullRequest;

  if (!ctx.runtime.versionPlan) {
    const handled = handleNoVersionPlan(ctx);
    core.setOutput("status", handled.status);
    if (handled.error) {
      core.setOutput("errors", handled.error);
      throw new Error(handled.error);
    }
    return;
  }

  if (
    issueCommentTarget &&
    !issueCommentTarget.labels.includes(pullRequest.label)
  ) {
    core.setOutput("status", "ignored");
    core.info(
      "Ignoring pubm slash command on a pull request without the release label.",
    );
    return;
  }

  configureGitAuthor(ctx.cwd);
  let planned = planReleasePrScopes(ctx);
  if (planned.length === 0) {
    core.setOutput("status", "no_pending_release");
    core.info("No pending release scopes found.");
    return;
  }

  const overrideResult = issueCommentTarget
    ? resolveReleasePrActionOverride({
        labels: issueCommentTarget.labels,
        comments: issueCommentTarget.comments,
        bumpLabels: pullRequest.bumpLabels,
      })
    : { errors: [] };

  if (overrideResult.errors.length > 0) {
    const message = formatOverrideErrors(overrideResult.errors);
    core.setOutput("status", "invalid_override");
    core.setOutput("errors", message);
    throw new Error(message);
  }

  if (issueCommentTarget) {
    const selected = selectIssueCommentScope(
      planned,
      issueCommentTarget.headBranch,
      issueCommentTarget.body,
    );
    if (!selected) {
      core.setOutput("status", "scope_not_found");
      throw new Error(
        `Could not match ${issueCommentTarget.headBranch} to a pending release PR scope.`,
      );
    }
    planned = [selected];
  }

  const prNumbers: number[] = [];
  const openReleasePrs = issueCommentTarget
    ? []
    : await listOpenReleasePullRequests(octokit, repo, {
        base: baseBranch,
        label: pullRequest.label,
      });
  const repoFullName = `${repo.owner}/${repo.repo}`;

  for (const item of planned) {
    const existingPr = issueCommentTarget
      ? undefined
      : selectExistingReleasePrForScope(item, openReleasePrs);
    const branchName =
      issueCommentTarget?.headBranch ??
      sameRepoHeadBranch(existingPr, repoFullName) ??
      item.branchName;
    checkoutReleaseBranch(ctx.cwd, baseBranch, branchName);
    const prepared = await materializeReleasePrScope(
      ctx,
      item.scope,
      overrideResult.override,
    );
    forcePushBranch(ctx.cwd, branchName);
    const prNumber = await createOrUpdatePullRequest(octokit, repo, {
      branch: branchName,
      base: baseBranch,
      title: prepared.title,
      body: prepared.body,
      label: pullRequest.label,
    });
    prNumbers.push(prNumber);

    try {
      await dryRunReleasePrScope(ctx, item.scope, overrideResult.override);
      await upsertComment(
        octokit,
        { ...repo, issueNumber: prNumber },
        dryRunCommentBody({
          scope: item.scope.displayName,
          status: "success",
        }),
        RELEASE_PR_DRY_RUN_MARKER,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await upsertComment(
        octokit,
        { ...repo, issueNumber: prNumber },
        dryRunCommentBody({
          scope: item.scope.displayName,
          status: "failure",
          message,
        }),
        RELEASE_PR_DRY_RUN_MARKER,
      );
      core.setOutput("status", "dry_run_failed");
      core.setOutput("errors", message);
      throw new Error(
        `Release PR dry run failed for ${item.scope.displayName}: ${message}`,
      );
    }
  }

  core.setOutput("status", "success");
  core.setOutput("pull-requests", prNumbers.join(","));
}

function handleNoVersionPlan(ctx: PubmContext): {
  status: "no_pending_release" | "unversioned_changes";
  error?: string;
} {
  const changes = ctx.runtime.releaseAnalysis?.unversionedChanges ?? [];
  if (changes.length === 0) {
    core.info("No pending release changes found.");
    return { status: "no_pending_release" };
  }

  const message = unversionedChangesMessage(changes);
  const policy = ctx.config.release.pullRequest.unversionedChanges;
  if (policy === "fail") {
    return { status: "unversioned_changes", error: message };
  }
  if (policy === "warn") {
    core.warning(message);
    return { status: "unversioned_changes" };
  }

  core.info("No versioned release changes found.");
  return { status: "no_pending_release" };
}

function unversionedChangesMessage(changes: UnversionedChange[]): string {
  const preview = changes
    .slice(0, 10)
    .map((change) => {
      const location = change.packagePath ? ` ${change.packagePath}` : "";
      return `- ${change.hash}${location}: ${change.summary} (${change.reason})`;
    })
    .join("\n");
  const suffix =
    changes.length > 10 ? `\n...and ${changes.length - 10} more.` : "";
  return [
    "No release PR was opened because pending changes did not produce a version bump.",
    preview,
    suffix,
  ]
    .filter(Boolean)
    .join("\n");
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
