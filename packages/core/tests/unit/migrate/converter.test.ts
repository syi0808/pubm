import { describe, expect, it } from "vitest";
import { convertToPublishConfig } from "../../../src/migrate/converter.js";
import type { ParsedMigrationConfig } from "../../../src/migrate/types.js";

function minimal(): ParsedMigrationConfig {
  return {
    source: "np",
    unmappable: [],
  };
}

describe("convertToPublishConfig", () => {
  it("converts minimal config with no fields", () => {
    const result = convertToPublishConfig(minimal());
    expect(result.config).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("maps git.branch to config.branch", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      git: { branch: "main" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.branch).toBe("main");
  });

  it("maps npm.publish=true to packages with npm registry", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      npm: { publish: true },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.packages).toEqual([
      { path: ".", registries: ["npm"] },
    ]);
  });

  it("maps npm.publish=false to packages with empty registries", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      npm: { publish: false },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.packages).toEqual([{ path: ".", registries: [] }]);
  });

  it("maps npm.access to config.access", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      npm: { publish: true, access: "public" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.access).toBe("public");
  });

  it("maps npm.tag to config.tag", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      npm: { publish: true, tag: "beta" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.tag).toBe("beta");
  });

  it("maps npm.publishPath to config.contents", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      npm: { publish: true, publishPath: "dist" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.contents).toBe("dist");
  });

  it("maps changelog.enabled=true to config.changelog=true", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      changelog: { enabled: true },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.changelog).toBe(true);
  });

  it("maps changelog.enabled=false to config.changelog=false", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      changelog: { enabled: false },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.changelog).toBe(false);
  });

  it("maps changelog.preset=github to changelogFormat=github", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      changelog: { enabled: true, preset: "github" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.changelogFormat).toBe("github");
  });

  it("does not set changelogFormat for non-github preset", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      changelog: { enabled: true, preset: "angular" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.changelogFormat).toBeUndefined();
  });

  it("maps github.draft to config.releaseDraft", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      github: { release: true, draft: true },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.releaseDraft).toBe(true);
  });

  it("maps github.release=false to releaseDraft=false and releaseNotes=false", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      github: { release: false },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.releaseDraft).toBe(false);
    expect(result.config.releaseNotes).toBe(false);
  });

  it("sets no releaseDraft when github.release=true and draft is undefined", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      github: { release: true },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.releaseDraft).toBeUndefined();
  });

  it("maps monorepo.fixed to config.fixed", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      monorepo: { fixed: [["pkg-a", "pkg-b"]] },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.fixed).toEqual([["pkg-a", "pkg-b"]]);
  });

  it("maps monorepo.linked to config.linked", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      monorepo: { linked: [["pkg-c", "pkg-d"]] },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.linked).toEqual([["pkg-c", "pkg-d"]]);
  });

  it("maps monorepo.updateInternalDeps to config.updateInternalDependencies", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      monorepo: { updateInternalDeps: "minor" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.updateInternalDependencies).toBe("minor");
  });

  it("generates warnings for hooks", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      hooks: [
        { lifecycle: "prePublish", command: "npm test" },
        { lifecycle: "postPublish", command: "echo done" },
      ],
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings).toContain(
      "Hook prePublish requires manual conversion to pubm plugin",
    );
    expect(result.warnings).toContain(
      "Hook postPublish requires manual conversion to pubm plugin",
    );
  });

  it("generates warning for prerelease branches", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      prerelease: {
        active: false,
        branches: [
          { name: "beta", prerelease: "beta" },
          { name: "alpha", prerelease: true },
        ],
      },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings).toContain(
      "Branch beta has prerelease config — not yet supported",
    );
    expect(result.warnings).toContain(
      "Branch alpha has prerelease config — not yet supported",
    );
  });

  it("generates warning for active prerelease", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      prerelease: { active: true },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings).toContain(
      "Pre-release mode is active, complete before migrating",
    );
  });

  it("generates warnings for unmappable items", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      unmappable: [
        { key: "someKey", value: true, reason: "not supported" },
        { key: "otherKey", value: 42, reason: "no equivalent" },
      ],
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings).toContain("someKey — not supported");
    expect(result.warnings).toContain("otherKey — no equivalent");
  });

  it("generates warning for custom commitMessage", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      git: { commitMessage: `chore: release v\${version}` },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings).toContain(
      "Custom commit message — pubm does not yet support",
    );
  });

  it("generates warning for non-default tagFormat", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      git: { tagFormat: `release-\${version}` },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings.some((w) => w.includes("custom tag format"))).toBe(
      true,
    );
  });

  it(`does not generate warning for default tagFormat v\${version}`, () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      git: { tagFormat: `v\${version}` },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings.some((w) => w.includes("custom tag format"))).toBe(
      false,
    );
  });

  it("maps ignore to config.ignore", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      ignore: ["@scope/pkg-a", "@scope/pkg-b"],
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.ignore).toEqual(["@scope/pkg-a", "@scope/pkg-b"]);
  });

  it("maps snapshotTemplate to config.snapshotTemplate", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      snapshotTemplate: "{tag}-{datetime}",
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.snapshotTemplate).toBe("{tag}-{datetime}");
  });

  it("maps cleanInstall to config.validate.cleanInstall", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      cleanInstall: true,
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.validate).toEqual({ cleanInstall: true });
  });

  it("generates warning when anyBranch is true", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      anyBranch: true,
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings.some((w) => w.includes("anyBranch"))).toBe(true);
  });

  it("generates warning for custom test script", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      tests: { enabled: true, script: "bun test" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings.some((w) => w.includes("bun test"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("testCommand"))).toBe(true);
  });

  it("does not generate test script warning when tests.script is absent", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      tests: { enabled: true },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings.some((w) => w.includes("testCommand"))).toBe(false);
  });

  it("passes through changesetFiles option", () => {
    const result = convertToPublishConfig(minimal(), {
      changesetFiles: [".changeset/foo.md"],
    });
    expect(result.changesetFiles).toEqual([".changeset/foo.md"]);
  });

  it("does not set changesetFiles when option is not provided", () => {
    const result = convertToPublishConfig(minimal());
    expect(result.changesetFiles).toBeUndefined();
  });

  it("maps changelog.file to config.changelog when changelog is enabled", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      changelog: { enabled: true, file: "CHANGELOG.md" },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.config.changelog).toBe("CHANGELOG.md");
  });

  it("generates warning when github.assets is present", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      github: { release: true, assets: ["dist/*.tgz", "dist/*.zip"] },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings.some((w) => w.includes("releaseAssets"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("dist/*.tgz"))).toBe(true);
  });

  it("does not generate assets warning when github.assets is empty", () => {
    const parsed: ParsedMigrationConfig = {
      ...minimal(),
      github: { release: true, assets: [] },
    };
    const result = convertToPublishConfig(parsed);
    expect(result.warnings.some((w) => w.includes("releaseAssets"))).toBe(
      false,
    );
  });
});
