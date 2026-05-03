import type { ResolvedPubmConfig } from "../../src/config/types.js";
import type { PubmContext } from "../../src/context.js";
import { createContext } from "../../src/context.js";
import type { ResolvedOptions } from "../../src/types/options.js";

export function makeTestConfig(
  overrides: Partial<ResolvedPubmConfig> = {},
): ResolvedPubmConfig {
  const base: ResolvedPubmConfig = {
    versioning: "independent",
    branch: "main",
    changelog: true,
    commit: false,
    access: "public",
    fixed: [],
    linked: [],
    updateInternalDependencies: "patch",
    ignore: [],
    snapshotTemplate: "{tag}-{timestamp}",
    tag: "latest",
    contents: ".",
    saveToken: true,
    releaseDraft: true,
    releaseNotes: true,
    release: {
      versioning: {
        mode: "independent",
        fixed: [],
        linked: [],
        updateInternalDependencies: "patch",
      },
      changesets: { directory: ".pubm/changesets" },
      commits: { format: "conventional", types: {} },
      changelog: true,
      pullRequest: {
        branchTemplate: "pubm/release/{scopeSlug}",
        titleTemplate: "chore(release): {scope} {version}",
        label: "pubm:release-pr",
        bumpLabels: {
          patch: "release:patch",
          minor: "release:minor",
          major: "release:major",
          prerelease: "release:prerelease",
        },
        grouping: "independent",
        fixed: [],
        linked: [],
        unversionedChanges: "warn",
      },
    },
    rollback: { strategy: "individual", dangerouslyAllowUnpublish: false },
    lockfileSync: "optional",
    packages: [],
    ecosystems: {},
    validate: { cleanInstall: true, entryPoints: true, extraneousFiles: true },
    plugins: [],
  };

  const config: ResolvedPubmConfig = { ...base, ...overrides };
  const release = overrides.release;
  const versioning = {
    ...base.release.versioning,
    ...release?.versioning,
    fixed: release?.versioning?.fixed ?? base.release.versioning.fixed,
    linked: release?.versioning?.linked ?? base.release.versioning.linked,
  };
  const pullRequest = {
    ...base.release.pullRequest,
    ...release?.pullRequest,
    bumpLabels: {
      ...base.release.pullRequest.bumpLabels,
      ...release?.pullRequest?.bumpLabels,
    },
  };
  config.release = {
    ...base.release,
    ...release,
    versioning,
    changesets: {
      ...base.release.changesets,
      ...release?.changesets,
    },
    commits: {
      ...base.release.commits,
      ...release?.commits,
      types: release?.commits?.types ?? base.release.commits.types,
    },
    pullRequest: {
      ...pullRequest,
      grouping: pullRequest.grouping ?? versioning.mode,
      fixed: release?.pullRequest?.fixed ?? versioning.fixed,
      linked: release?.pullRequest?.linked ?? versioning.linked,
    },
  };
  config.versioning = config.release.versioning.mode;
  config.fixed = config.release.versioning.fixed;
  config.linked = config.release.versioning.linked;
  config.updateInternalDependencies =
    config.release.versioning.updateInternalDependencies;
  config.changelog = config.release.changelog;

  return config;
}

export function makeTestOptions(
  overrides: Partial<ResolvedOptions> = {},
): ResolvedOptions {
  return {
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "latest",
    saveToken: true,
    ...overrides,
  };
}

export function makeTestContext(
  overrides: {
    config?: Partial<ResolvedPubmConfig>;
    options?: Partial<ResolvedOptions>;
    runtime?: Partial<PubmContext["runtime"]>;
    cwd?: string;
  } = {},
): PubmContext {
  const ctx = createContext(
    makeTestConfig(overrides.config),
    makeTestOptions(overrides.options),
    overrides.cwd,
  );
  if (overrides.runtime) {
    Object.assign(ctx.runtime, overrides.runtime);
  }
  return ctx;
}
