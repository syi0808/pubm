import { describe, expect, it } from "vitest";
import { buildVersionPrBody } from "../../../src/tasks/version-pr-body.js";

describe("buildVersionPrBody", () => {
  it("builds PR body with version table and changelog", () => {
    const body = buildVersionPrBody({
      packages: [
        { name: "@pubm/core", version: "1.2.3", bump: "patch" },
        { name: "pubm", version: "2.0.0", bump: "major" },
      ],
      changelogs: new Map([
        ["@pubm/core", "- Fix rollback on partial publish failure"],
        ["pubm", "- Breaking: restructure CLI commands"],
      ]),
    });

    expect(body).toContain("# Version Packages");
    expect(body).toContain("| @pubm/core | 1.2.3 | patch |");
    expect(body).toContain("| pubm | 2.0.0 | major |");
    expect(body).toContain("### @pubm/core@1.2.3");
    expect(body).toContain("- Fix rollback on partial publish failure");
    expect(body).toContain("### pubm@2.0.0");
    expect(body).toContain("- Breaking: restructure CLI commands");
  });

  it("builds PR body without changelog when none provided", () => {
    const body = buildVersionPrBody({
      packages: [{ name: "pubm", version: "1.0.0", bump: "minor" }],
      changelogs: new Map(),
    });

    expect(body).toContain("# Version Packages");
    expect(body).toContain("| pubm | 1.0.0 | minor |");
    expect(body).not.toContain("## Changelog");
  });
});
