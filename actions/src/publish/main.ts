import * as core from "@actions/core";
import * as github from "@actions/github";
import { configureGitAuthor } from "../git.js";
import {
  getPullRequest,
  pullRequestsForCommit,
  repoContext,
} from "../github.js";
import { loadPubmContext } from "../pubm/config.js";
import { publishMergedReleasePr } from "../pubm/publish.js";
import {
  branchPrefixFromTemplate,
  isMergedReleasePullRequest,
  isPushToBaseBranch,
  isUsablePushRange,
} from "./workflow.js";

async function run(): Promise<void> {
  const token = core.getInput("token", { required: true });
  const workingDirectory = core.getInput("working-directory") || ".";
  const baseBranch =
    core.getInput("base-branch") ||
    github.context.payload.repository?.default_branch ||
    "main";

  if (
    !isPushToBaseBranch({
      eventName: github.context.eventName,
      ref: github.context.ref,
      baseBranch,
    })
  ) {
    core.setOutput("status", "ignored");
    core.info(
      `Ignoring event ${github.context.eventName} on ref ${github.context.ref}.`,
    );
    return;
  }

  const beforeSha = github.context.payload.before;
  const afterSha = github.context.sha;
  if (!isUsablePushRange(beforeSha, afterSha)) {
    core.setOutput("status", "ignored");
    core.info("Missing push before/after SHA.");
    return;
  }

  const octokit = github.getOctokit(token);
  const repo = repoContext();
  const ctx = await loadPubmContext({ workingDirectory, baseBranch });
  const pullRequest = ctx.config.release.pullRequest;
  const associatedPrs = await pullRequestsForCommit(octokit, repo, afterSha);
  const releasePrs = [];
  for (const associatedPr of associatedPrs) {
    const fullPr = await getPullRequest(octokit, repo, associatedPr.number);
    if (
      isMergedReleasePullRequest(fullPr, {
        baseBranch,
        label: pullRequest.label,
        branchPrefix: branchPrefixFromTemplate(pullRequest.branchTemplate),
      })
    ) {
      releasePrs.push(fullPr);
    }
  }

  if (releasePrs.length === 0) {
    core.setOutput("status", "ignored");
    core.info("Push is not associated with a merged pubm release PR.");
    return;
  }

  if (releasePrs.length > 1) {
    core.setOutput("status", "ambiguous_release_pr");
    throw new Error(
      `Push is associated with multiple merged pubm release PRs: ${releasePrs
        .map((pr) => `#${pr.number}`)
        .join(", ")}`,
    );
  }

  process.env.GITHUB_TOKEN = token;
  configureGitAuthor(ctx.cwd);
  const status = await publishMergedReleasePr(ctx, { beforeSha, afterSha });
  core.setOutput("status", status);
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
