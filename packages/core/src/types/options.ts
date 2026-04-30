import type { PackageConfig } from "../config/types.js";

export type RegistryType = "npm" | "jsr" | "crates" | string;

/** Selects a split release workflow phase. Omit for the full release pipeline. */
export type ReleasePhase = "prepare" | "publish";

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
   * @description Run only one release phase. Omit to run the full release pipeline.
   */
  phase?: ReleasePhase;
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
   * @description Skip dry-run validation during prepare phase
   * @default false
   */
  skipDryRun?: boolean;
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
   * @description Create a pull request for the version bump instead of pushing directly
   * @default false
   */
  createPr?: boolean;
  /**
   * @description Per-package publish configuration (from pubm.config.ts)
   */
  packages?: PackageConfig[];
}

export interface ResolvedOptions extends Options {
  testScript: string;
  buildScript: string;
  branch: string;
  tag: string;
  saveToken: boolean;
  packages?: PackageConfig[];
}
