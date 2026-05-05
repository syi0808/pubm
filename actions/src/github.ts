import * as github from "@actions/github";

export type Octokit = ReturnType<typeof github.getOctokit>;

export interface RepoContext {
  owner: string;
  repo: string;
}

export function repoContext(): RepoContext {
  return github.context.repo;
}

export async function findOpenPullRequestByHead(
  octokit: Octokit,
  repo: RepoContext,
  input: { owner: string; branch: string; base: string },
) {
  const { data } = await octokit.rest.pulls.list({
    ...repo,
    state: "open",
    base: input.base,
    head: `${input.owner}:${input.branch}`,
    per_page: 10,
  });
  return data[0];
}

export async function listOpenReleasePullRequests(
  octokit: Octokit,
  repo: RepoContext,
  input: { base: string; label: string },
) {
  const { data } = await octokit.rest.pulls.list({
    ...repo,
    state: "open",
    base: input.base,
    per_page: 100,
  });

  return data.filter((pr) =>
    (pr.labels ?? []).some((label) => label.name === input.label),
  );
}

export async function createOrUpdatePullRequest(
  octokit: Octokit,
  repo: RepoContext,
  input: {
    branch: string;
    base: string;
    title: string;
    body: string;
    label: string;
  },
): Promise<number> {
  const existing = await findOpenPullRequestByHead(octokit, repo, {
    owner: repo.owner,
    branch: input.branch,
    base: input.base,
  });

  if (existing) {
    await octokit.rest.pulls.update({
      ...repo,
      pull_number: existing.number,
      title: input.title,
      body: input.body,
    });
    await octokit.rest.issues.addLabels({
      ...repo,
      issue_number: existing.number,
      labels: [input.label],
    });
    return existing.number;
  }

  const { data: pr } = await octokit.rest.pulls.create({
    ...repo,
    head: input.branch,
    base: input.base,
    title: input.title,
    body: input.body,
  });
  await octokit.rest.issues.addLabels({
    ...repo,
    issue_number: pr.number,
    labels: [input.label],
  });
  return pr.number;
}

export async function getPullRequest(
  octokit: Octokit,
  repo: RepoContext,
  pullNumber: number,
) {
  const { data } = await octokit.rest.pulls.get({
    ...repo,
    pull_number: pullNumber,
  });
  return data;
}

export async function listIssueComments(
  octokit: Octokit,
  repo: RepoContext,
  issueNumber: number,
) {
  const { data } = await octokit.rest.issues.listComments({
    ...repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  return data;
}

export async function getRepositoryPermission(
  octokit: Octokit,
  repo: RepoContext,
  username: string,
): Promise<string> {
  const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
    ...repo,
    username,
  });
  return data.permission;
}

export async function pullRequestsForCommit(
  octokit: Octokit,
  repo: RepoContext,
  sha: string,
) {
  const { data } =
    await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
      ...repo,
      commit_sha: sha,
    });
  return data;
}

export async function pullRequestForCommit(
  octokit: Octokit,
  repo: RepoContext,
  sha: string,
) {
  const data = await pullRequestsForCommit(octokit, repo, sha);
  return data[0];
}
