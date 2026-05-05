import path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  createKeyResolver,
  loadConfig,
  type ResolvedPubmConfig,
  resolveConfig,
} from "@pubm/core";
import { upsertComment } from "../comment.js";
import { detectChangesetFiles } from "../detect.js";
import {
  invalidBody,
  missingBody,
  skippedBody,
  successBody,
} from "../templates.js";
import { validateChangesets } from "../validate.js";

async function run(): Promise<void> {
  const skipLabel = core.getInput("skip-label");
  const shouldComment = core.getInput("comment") === "true";
  const token = core.getInput("token");
  const workingDirectory = core.getInput("working-directory");
  const cwd = path.resolve(process.cwd(), workingDirectory || ".");
  const changesetConfig = await loadChangesetCheckConfig(cwd);

  const octokit = github.getOctokit(token);
  const { context } = github;

  if (!context.payload.pull_request) {
    core.setFailed("This action can only run on pull_request events");
    return;
  }

  const pr = context.payload.pull_request;
  const commentCtx = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issueNumber: pr.number,
  };

  // Check skip label
  const labels: Array<{ name: string }> = pr.labels ?? [];
  if (labels.some((l) => l.name === skipLabel)) {
    core.setOutput("status", "skipped");
    core.setOutput("changeset-files", "");
    core.setOutput("errors", "[]");

    if (shouldComment) {
      await upsertComment(octokit, commentCtx, skippedBody(skipLabel));
    }
    return;
  }

  // Detect changeset files
  const baseBranch = pr.base.ref;
  const files = detectChangesetFiles(
    baseBranch,
    cwd,
    changesetConfig.directory,
  );
  core.setOutput("changeset-files", files.join("\n"));

  if (files.length === 0) {
    core.setOutput("status", "missing");
    core.setOutput("errors", "[]");

    if (shouldComment) {
      await upsertComment(octokit, commentCtx, missingBody(skipLabel));
    }
    core.setFailed("No changeset found");
    return;
  }

  // Validate changesets
  const result = validateChangesets(files, cwd, changesetConfig.resolveKey);
  core.setOutput("errors", JSON.stringify(result.errors));

  if (result.errors.length > 0) {
    core.setOutput("status", "invalid");

    if (shouldComment) {
      await upsertComment(octokit, commentCtx, invalidBody(result.errors));
    }
    core.setFailed(`${result.errors.length} changeset validation error(s)`);
    return;
  }

  // All valid
  core.setOutput("status", "success");

  if (shouldComment) {
    await upsertComment(octokit, commentCtx, successBody(result.valid));
  }
}

async function loadChangesetCheckConfig(cwd: string): Promise<{
  directory: string;
  resolveKey: (key: string) => string | undefined;
}> {
  const loaded = (await loadConfig(cwd)) ?? {};
  const config: ResolvedPubmConfig = await resolveConfig(loaded, cwd);
  return {
    directory: config.release.changesets.directory,
    resolveKey: createKeyResolver(config.packages),
  };
}

run().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
