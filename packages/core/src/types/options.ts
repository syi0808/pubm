import type { PackageConfig } from "../config/types.js";

export type RegistryType = "npm" | "jsr" | "crates" | string;

/** Determines how the release pipeline behaves (interactive vs automated). */
export type ReleaseMode = "local" | "ci";

/**
 * Options for configuring the {@linkcode pubm} function.
 */
export interface Options {
  /**
   * @description The npm script to run tests before publishing
   * @default "test"
   */
  testScript?: string;
  /**
   * @description The npm script to run build before publishing
   * @default "build"
   */
  buildScript?: string;
  /**
   * @description Release mode — "local" for interactive TTY, "ci" for automated pipelines
   * @default "local"
   */
  mode?: ReleaseMode;
  /**
   * @description Run only the prepare phase (version bump, git tag, build) without publishing
   * @default false
   */
  prepare?: boolean;
  /**
   * @description Run only the publish phase (publish from latest tag, create release draft)
   * @default false
   */
  publish?: boolean;
  /**
   * @description Simulate the full pipeline without side-effects (no publish, no git push)
   * @default false
   */
  dryRun?: boolean;
  /**
   * @description Target branch for the release
   * @default "main"
   */
  branch?: string;
  /**
   * @description Allow publishing from any branch
   * @default false
   */
  anyBranch?: boolean;
  /**
   * @description Skip running tests before publishing
   * @default false
   */
  skipTests?: boolean;
  /**
   * @description Skip build before publishing
   * @default false
   */
  skipBuild?: boolean;
  /**
   * @description Skip publishing task
   * @default false
   */
  skipPublish?: boolean;
  /**
   * @description Skip creating a GitHub release
   * @default false
   */
  skipReleaseDraft?: boolean;
  /**
   * @description Create GitHub Release as draft (not published)
   * @default false
   */
  releaseDraft?: boolean;
  /**
   * @description Skip prerequisites check task
   * @default false
   */
  skipPrerequisitesCheck?: boolean;
  /**
   * @description Skip required conditions check task
   * @default false
   */
  skipConditionsCheck?: boolean;
  /**
   * @description Snapshot mode: publish a temporary snapshot version
   */
  snapshot?: string | boolean;
  /**
   * @description Publish under a specific dist-tag
   * @default "latest"
   */
  tag?: string;
  /**
   * @description Subdirectory to publish
   */
  contents?: string;
  /**
   * @description Do not save jsr tokens (request the token each time)
   * @default true
   */
  saveToken?: boolean;
  /**
   * @description Per-package publish configuration (from pubm.config.ts)
   */
  packages?: PackageConfig[];
}

export interface ResolvedOptions extends Options {
  testScript: string;
  buildScript: string;
  mode: ReleaseMode;
  branch: string;
  tag: string;
  saveToken: boolean;
  packages?: PackageConfig[];
}
