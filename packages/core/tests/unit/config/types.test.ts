import { describe, expect, it } from "vitest";
import type { PackageConfig } from "../../../src/config/types.js";
import { defineConfig } from "../../../src/config/types.js";

describe("defineConfig", () => {
  it("returns the config object unchanged", () => {
    const config = defineConfig({
      branch: "main",
      packages: [{ path: ".", registries: ["npm"] }],
    });
    expect(config).toEqual({
      branch: "main",
      packages: [{ path: ".", registries: ["npm"] }],
    });
  });

  it("accepts empty config", () => {
    const config = defineConfig({});
    expect(config).toEqual({});
  });

  it("accepts full config with all fields", () => {
    const config = defineConfig({
      branch: "main",
      packages: [
        { path: ".", registries: ["npm", "jsr"] },
        {
          path: "packages/core",
          registries: ["npm"],
          buildCommand: "build",
          testCommand: "test",
        },
      ],
      release: {
        versioning: {
          mode: "independent",
          fixed: [["@myorg/core", "@myorg/utils"]],
          linked: [["@myorg/react-*"]],
          updateInternalDependencies: "patch",
        },
        changesets: { directory: ".pubm/changesets" },
        commits: {
          format: "conventional",
          types: {
            feat: "minor",
            fix: "patch",
            chore: false,
          },
        },
        changelog: true,
        pullRequest: {
          branchTemplate: "release/{scopeSlug}",
          titleTemplate: "chore(release): {scope} {version}",
          label: "pubm:release-pr",
          bumpLabels: {
            patch: "release:patch",
            minor: "release:minor",
            major: "release:major",
            prerelease: "release:prerelease",
          },
          grouping: "independent",
          fixed: [["@myorg/core", "@myorg/utils"]],
          linked: [["@myorg/react-*"]],
          unversionedChanges: "warn",
        },
      },
      commit: false,
      access: "public",
      ignore: ["@myorg/internal"],
      validate: {
        cleanInstall: true,
        entryPoints: true,
        extraneousFiles: true,
      },
      snapshotTemplate: "{tag}-{timestamp}",
      tag: "latest",
      contents: ".",
      saveToken: true,
      releaseDraft: true,
      releaseNotes: true,
      rollbackStrategy: "individual",
    });
    expect(config.release?.versioning.mode).toBe("independent");
    expect(config.release?.versioning.fixed).toHaveLength(1);
    expect(config.release?.pullRequest.unversionedChanges).toBe("warn");
  });

  it("does not type legacy createPr as a supported config field", () => {
    // @ts-expect-error createPr was removed in favor of GitHub release PR workflows.
    const config = defineConfig({ createPr: true });
    expect(config).toEqual({ createPr: true });
  });

  it("does not type versionSources as a supported config field", () => {
    const config = defineConfig({
      // @ts-expect-error versionSources was removed; changesets and commits are always release inputs.
      versionSources: "changesets",
    });
    expect(config).toEqual({ versionSources: "changesets" });
  });

  it("does not type top-level conventionalCommits as a supported config field", () => {
    const config = defineConfig({
      // @ts-expect-error conventional commit parsing config moved to release.commits.
      conventionalCommits: { types: { feat: "minor" } },
    });
    expect(config).toEqual({
      conventionalCommits: { types: { feat: "minor" } },
    });
  });

  it("does not type top-level releasePr as a supported config field", () => {
    const config = defineConfig({
      // @ts-expect-error Release PR config moved to release.pullRequest.
      releasePr: { enabled: true },
    });
    expect(config).toEqual({ releasePr: { enabled: true } });
  });

  it("does not type release.pullRequest.enabled as a supported config field", () => {
    const config = defineConfig({
      release: {
        pullRequest: {
          // @ts-expect-error Release PR actions are enabled by workflow invocation, not config.
          enabled: true,
        },
      },
    });
    expect(config).toEqual({ release: { pullRequest: { enabled: true } } });
  });

  it("PackageConfig accepts ecosystem field", () => {
    const config: PackageConfig = {
      path: "packages/core",
      registries: ["npm"],
      ecosystem: "js",
    };
    expect(config.ecosystem).toBe("js");
  });

  it("PackageConfig accepts rust ecosystem", () => {
    const config: PackageConfig = {
      path: "crates/parser",
      registries: ["crates"],
      ecosystem: "rust",
    };
    expect(config.ecosystem).toBe("rust");
  });
});
