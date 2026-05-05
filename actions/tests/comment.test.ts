import { describe, expect, it, vi } from "vitest";
import { upsertComment } from "../src/comment.js";

function createMockOctokit(
  existingComments: Array<{ id: number; body: string }> = [],
) {
  return {
    rest: {
      issues: {
        listComments: vi.fn().mockResolvedValue({ data: existingComments }),
        createComment: vi.fn().mockResolvedValue({}),
        updateComment: vi.fn().mockResolvedValue({}),
      },
    },
  } as any;
}

const ctx = { owner: "test-owner", repo: "test-repo", issueNumber: 1 };

describe("upsertComment", () => {
  it("creates a new comment when none exists", async () => {
    const octokit = createMockOctokit([]);

    await upsertComment(octokit, ctx, "<!-- pubm:changeset-check -->\nHello");

    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 1,
      body: "<!-- pubm:changeset-check -->\nHello",
    });
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("updates existing comment found by marker", async () => {
    const octokit = createMockOctokit([
      { id: 42, body: "<!-- pubm:changeset-check -->\nOld content" },
    ]);

    await upsertComment(
      octokit,
      ctx,
      "<!-- pubm:changeset-check -->\nNew content",
    );

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 42,
      body: "<!-- pubm:changeset-check -->\nNew content",
    });
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("does not match comments without marker", async () => {
    const octokit = createMockOctokit([
      { id: 10, body: "Some unrelated comment" },
    ]);

    await upsertComment(octokit, ctx, "<!-- pubm:changeset-check -->\nHello");

    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });

  it("only updates comments matching the requested marker", async () => {
    const octokit = createMockOctokit([
      { id: 10, body: "<!-- pubm:changeset-check -->\nChangeset check" },
      { id: 20, body: "<!-- pubm:release-pr -->\nRelease PR" },
    ]);

    await upsertComment(
      octokit,
      ctx,
      "<!-- pubm:release-pr -->\nUpdated release PR",
      "<!-- pubm:release-pr -->",
    );

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 20,
      body: "<!-- pubm:release-pr -->\nUpdated release PR",
    });
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });
});
