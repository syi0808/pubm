import { describe, expect, it } from "vitest";
import {
  renderReleasePrBranch,
  renderReleasePrTitle,
  slugifyReleasePrToken,
} from "../../../../src/workflow/release-utils/release-pr-naming.js";
import type { ReleasePrScope } from "../../../../src/workflow/release-utils/scope.js";

describe("release PR naming", () => {
  it("creates branch-safe slugs", () => {
    expect(slugifyReleasePrToken("@acme/pkg::js / Next Release")).toBe(
      "acme-pkg-js-next-release",
    );
    expect(slugifyReleasePrToken("////")).toBe("release");
  });

  it("renders default branch and title templates", () => {
    const scope: ReleasePrScope = {
      id: "packages/a::js",
      kind: "package",
      packageKeys: ["packages/a::js"],
      displayName: "@acme/a",
      slug: "acme-a",
    };

    expect(renderReleasePrBranch({ scope, version: "1.2.3" })).toBe(
      "pubm/release/acme-a",
    );
    expect(renderReleasePrBranch({ scope, version: "2.0.0" })).toBe(
      "pubm/release/acme-a",
    );
    expect(renderReleasePrTitle({ scope, version: "1.2.3" })).toBe(
      "chore(release): @acme/a 1.2.3",
    );
  });

  it("renders group package keys deterministically", () => {
    const scope: ReleasePrScope = {
      id: "group",
      kind: "group",
      packageKeys: ["packages/b::js", "packages/a::js"],
      displayName: "@acme/a, @acme/b",
      slug: "acme-a-acme-b",
    };

    expect(
      renderReleasePrBranch({
        scope,
        version: "2.0.0",
        template: "release/{scopeSlug}/{packageKeySlug}/{version}",
      }),
    ).toBe("release/acme-a-acme-b/packages-a-js-packages-b-js/2.0.0");
  });
});
