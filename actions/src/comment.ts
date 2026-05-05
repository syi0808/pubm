import type * as github from "@actions/github";
import { MARKER } from "./templates.js";

type Octokit = ReturnType<typeof github.getOctokit>;

interface CommentContext {
  owner: string;
  repo: string;
  issueNumber: number;
}

export async function upsertComment(
  octokit: Octokit,
  ctx: CommentContext,
  body: string,
  marker = MARKER,
): Promise<void> {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.issueNumber,
  });

  const existing = comments.find((c) => c.body?.includes(marker));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: ctx.owner,
      repo: ctx.repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner: ctx.owner,
      repo: ctx.repo,
      issue_number: ctx.issueNumber,
      body,
    });
  }
}
