import { describe, expect, it } from "vitest";
import type { PlannedReleasePrScope } from "../src/pubm/release-pr.js";
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
} from "../src/release-pr/workflow.js";

function planned(branchName: string, slug: string): PlannedReleasePrScope {
  return {
    branchName,
    title: `Release ${slug}`,
    version: "1.2.3",
    scope: {
      id: slug,
      kind: "package",
      packageKeys: [slug],
      displayName: slug,
      slug,
    },
  };
}

describe("release-pr workflow helpers", () => {
  it("routes only supported release-pr events", () => {
    expect(isReleasePrEvent("push")).toBe(true);
    expect(isReleasePrEvent("workflow_dispatch")).toBe(true);
    expect(isReleasePrEvent("issue_comment")).toBe(true);
    expect(isReleasePrEvent("pull_request")).toBe(false);
  });

  it("detects pubm slash commands on any comment line", () => {
    expect(isPubmSlashCommand("hello\n/pubm bump minor")).toBe(true);
    expect(isPubmSlashCommand("  /PUBM release-as 2.0.0")).toBe(true);
    expect(isPubmSlashCommand("/publish bump minor")).toBe(false);
    expect(isPubmSlashCommand(undefined)).toBe(false);
  });

  it("accepts only repository write permissions for slash commands", () => {
    expect(isAuthorizedRepositoryPermission("write")).toBe(true);
    expect(isAuthorizedRepositoryPermission("maintain")).toBe(true);
    expect(isAuthorizedRepositoryPermission("admin")).toBe(true);
    expect(isAuthorizedRepositoryPermission("read")).toBe(false);
    expect(isAuthorizedRepositoryPermission(undefined)).toBe(false);
  });

  it("selects the commented release PR scope from the head branch", () => {
    const scopes = [
      planned("pubm-release-core-1-2-3", "core"),
      planned("pubm-release-cli-1-2-3", "cli"),
    ];

    expect(selectIssueCommentScope(scopes, "pubm-release-cli-1-2-3")).toBe(
      scopes[1],
    );
    expect(selectIssueCommentScope(scopes, "release/core/manual")).toBe(
      scopes[0],
    );
    expect(selectIssueCommentScope(scopes, "unknown")).toBeUndefined();
    expect(selectIssueCommentScope([scopes[0]], "renamed-branch")).toBe(
      scopes[0],
    );
  });

  it("selects the commented release PR scope from body metadata before branch fallback", () => {
    const scopes = [
      planned("pubm-release-core-1-2-3", "core"),
      planned("pubm-release-cli-1-2-3", "cli"),
    ];
    const body =
      '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":"cli","packageKeys":["cli"]} -->';

    expect(selectIssueCommentScope(scopes, "renamed-branch", body)).toBe(
      scopes[1],
    );
  });

  it("matches an existing open release PR by scope metadata regardless of branch version", () => {
    const item = planned("pubm/release/core/1.3.0", "core");

    const existing = selectExistingReleasePrForScope(item, [
      {
        number: 7,
        body: '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":"core","packageKeys":["core"]} -->',
        head: {
          ref: "pubm/release/core/1.2.0",
          repo: { full_name: "pubm-org/repo" },
        },
      },
    ]);

    expect(existing?.number).toBe(7);
    expect(sameRepoHeadBranch(existing, "pubm-org/repo")).toBe(
      "pubm/release/core/1.2.0",
    );
  });

  it("falls back to legacy release PR marker plus scope slug when metadata is missing", () => {
    const item = planned("pubm/release/core", "core");

    const existing = selectExistingReleasePrForScope(item, [
      {
        number: 8,
        body: "<!-- pubm:release-pr -->",
        head: { ref: "pubm/release/core/1.2.0" },
      },
    ]);

    expect(existing?.number).toBe(8);
  });

  it("does not reuse fork branches for release PR updates", () => {
    expect(
      sameRepoHeadBranch(
        {
          number: 9,
          head: {
            ref: "pubm/release/core",
            repo: { full_name: "someone/repo" },
          },
        },
        "pubm-org/repo",
      ),
    ).toBeUndefined();
  });

  it("fails when multiple open release PRs match one scope", () => {
    const item = planned("pubm/release/core", "core");
    const body =
      '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":"core","packageKeys":["core"]} -->';

    expect(() =>
      selectExistingReleasePrForScope(item, [
        { number: 1, body, head: { ref: "pubm/release/core-a" } },
        { number: 2, body, head: { ref: "pubm/release/core-b" } },
      ]),
    ).toThrow("Multiple open pubm release PRs match core (core): #1, #2");
  });

  it("formats override parser errors for action output", () => {
    expect(
      formatOverrideErrors([
        { command: "/pubm bump huge", message: "Unsupported bump override" },
        { message: "Invalid release-as version" },
      ]),
    ).toBe(
      "/pubm bump huge: Unsupported bump override\nInvalid release-as version",
    );
  });

  it("renders slash command and dry-run comments with stable markers", () => {
    expect(unauthorizedCommandBody("octo")).toContain(
      RELEASE_PR_COMMAND_MARKER,
    );
    expect(dryRunCommentBody({ scope: "core", status: "success" })).toContain(
      RELEASE_PR_DRY_RUN_MARKER,
    );
    expect(
      dryRunCommentBody({
        scope: "core",
        status: "failure",
        message: "missing token",
      }),
    ).toContain("missing token");
  });
});
