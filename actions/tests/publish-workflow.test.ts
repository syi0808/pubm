import { describe, expect, it } from "vitest";
import {
  branchPrefixFromTemplate,
  hasLabel,
  isMergedReleasePullRequest,
  isPushToBaseBranch,
  isUsablePushRange,
} from "../src/publish/workflow.js";

describe("publish workflow helpers", () => {
  it("only accepts push events on the configured base branch", () => {
    expect(
      isPushToBaseBranch({
        eventName: "push",
        ref: "refs/heads/main",
        baseBranch: "main",
      }),
    ).toBe(true);
    expect(
      isPushToBaseBranch({
        eventName: "pull_request",
        ref: "refs/heads/main",
        baseBranch: "main",
      }),
    ).toBe(false);
    expect(
      isPushToBaseBranch({
        eventName: "push",
        ref: "refs/heads/feature",
        baseBranch: "main",
      }),
    ).toBe(false);
  });

  it("matches release labels by name", () => {
    expect(hasLabel([{ name: "pubm:release" }], "pubm:release")).toBe(true);
    expect(hasLabel([{ name: "other" }, {}], "pubm:release")).toBe(false);
  });

  it("derives the release branch prefix from the configured template", () => {
    expect(
      branchPrefixFromTemplate("pubm/release/{packageKeySlug}/{version}"),
    ).toBe("pubm/release/");
    expect(branchPrefixFromTemplate("release/{version}")).toBe("release/");
    expect(branchPrefixFromTemplate("{scope}/{version}")).toBe("");
    expect(branchPrefixFromTemplate()).toBe("pubm/release/");
  });

  it("matches only merged release PRs for the configured branch and label", () => {
    const pr = {
      merged: true,
      base: { ref: "main" },
      head: { ref: "pubm/release/core" },
      body: '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":"core","packageKeys":["core"]} -->',
      labels: [{ name: "pubm:release-pr" }],
    };
    const input = {
      baseBranch: "main",
      label: "pubm:release-pr",
      branchPrefix: "pubm/release/",
    };

    expect(isMergedReleasePullRequest(pr, input)).toBe(true);
    expect(
      isMergedReleasePullRequest(
        { ...pr, head: { ref: "feature" }, body: "plain" },
        input,
      ),
    ).toBe(false);
    expect(
      isMergedReleasePullRequest({ ...pr, labels: [{ name: "other" }] }, input),
    ).toBe(false);
    expect(isMergedReleasePullRequest({ ...pr, merged: false }, input)).toBe(
      false,
    );
  });

  it("accepts marked release PRs even when custom branch templates have no static prefix", () => {
    const pr = {
      merged: true,
      base: { ref: "main" },
      head: { ref: "1.2.3/core" },
      body: '<!-- pubm:release-pr -->\n<!-- pubm:release-pr-metadata {"schemaVersion":1,"scopeId":"core","packageKeys":["core"]} -->',
      labels: [{ name: "pubm:release-pr" }],
    };

    expect(
      isMergedReleasePullRequest(pr, {
        baseBranch: "main",
        label: "pubm:release-pr",
        branchPrefix: "",
      }),
    ).toBe(true);
    expect(
      isMergedReleasePullRequest(
        { ...pr, body: "plain" },
        {
          baseBranch: "main",
          label: "pubm:release-pr",
          branchPrefix: "",
        },
      ),
    ).toBe(false);
  });

  it("requires a non-zero before and after SHA range", () => {
    expect(isUsablePushRange("abc", "def")).toBe(true);
    expect(isUsablePushRange(undefined, "def")).toBe(false);
    expect(isUsablePushRange("abc", undefined)).toBe(false);
    expect(
      isUsablePushRange("0000000000000000000000000000000000000000", "def"),
    ).toBe(false);
  });
});
