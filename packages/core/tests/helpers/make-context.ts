import type { ResolvedPubmConfig } from "../../src/config/types.js";
import type { PubmContext } from "../../src/context.js";
import { createContext } from "../../src/context.js";
import type { ResolvedOptions } from "../../src/types/options.js";

export function makeTestConfig(
  overrides: Partial<ResolvedPubmConfig> = {},
): ResolvedPubmConfig {
  return {
    versioning: "independent",
    branch: "main",
    changelog: true,
    changelogFormat: "default",
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
    rollback: { strategy: "individual", dangerouslyAllowUnpublish: false },
    lockfileSync: "optional",
    packages: [],
    ecosystems: {},
    validate: { cleanInstall: true, entryPoints: true, extraneousFiles: true },
    plugins: [],
    ...overrides,
  };
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
