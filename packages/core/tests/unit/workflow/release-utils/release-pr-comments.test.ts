import { describe, expect, it } from "vitest";
import {
  RELEASE_PR_DRY_RUN_COMMENT_MARKER,
  renderReleasePrDryRunPassedComment,
} from "../../../../src/workflow/release-utils/release-pr-comments.js";

describe("renderReleasePrDryRunPassedComment", () => {
  it("renders the marker, scoped status, and CI workflow run link", () => {
    expect(
      renderReleasePrDryRunPassedComment({
        scope: { displayName: "release" },
        runUrl: "https://github.com/acme/repo/actions/runs/123",
      }),
    ).toBe(
      [
        RELEASE_PR_DRY_RUN_COMMENT_MARKER,
        "### release and publish dry-run passed",
        "",
        "Scope: `release`",
        "",
        "CI run: [View workflow run](https://github.com/acme/repo/actions/runs/123)",
      ].join("\n"),
    );
  });

  it("accepts string scopes and omits the link when unavailable", () => {
    expect(renderReleasePrDryRunPassedComment({ scope: "@acme/a" })).toBe(
      [
        RELEASE_PR_DRY_RUN_COMMENT_MARKER,
        "### release and publish dry-run passed",
        "",
        "Scope: `@acme/a`",
      ].join("\n"),
    );
  });

  it("sanitizes scope text before embedding it in markdown", () => {
    expect(
      renderReleasePrDryRunPassedComment({
        scope: "pkg`name\nnext line",
      }),
    ).toBe(
      [
        RELEASE_PR_DRY_RUN_COMMENT_MARKER,
        "### release and publish dry-run passed",
        "",
        "Scope: ``pkg`name next line``",
      ].join("\n"),
    );
  });
});
