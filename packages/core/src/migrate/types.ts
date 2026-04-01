import type { PubmConfig } from "../config/types.js";

export type MigrationSourceName =
  | "semantic-release"
  | "release-it"
  | "changesets"
  | "np";

export interface DetectResult {
  found: boolean;
  configFiles: string[];
  relatedFiles: string[];
}

export interface ParsedMigrationConfig {
  source: MigrationSourceName;

  npm?: {
    publish: boolean;
    access?: "public" | "restricted";
    tag?: string;
    publishPath?: string;
  };
  github?: {
    release: boolean;
    draft?: boolean;
    assets?: string[];
  };
  git?: {
    branch?: string;
    tagFormat?: string;
    commitMessage?: string;
    requireCleanWorkdir?: boolean;
  };
  changelog?: {
    enabled: boolean;
    file?: string;
    preset?: string;
  };
  tests?: {
    enabled: boolean;
    script?: string;
  };

  monorepo?: {
    fixed?: string[][];
    linked?: string[][];
    updateInternalDeps?: "patch" | "minor";
  };
  hooks?: Array<{
    lifecycle: string;
    command: string;
  }>;
  prerelease?: {
    active: boolean;
    tag?: string;
    branches?: Array<{ name: string; prerelease: string | true }>;
  };

  unmappable: Array<{
    key: string;
    value: unknown;
    reason: string;
  }>;
}

export interface ConvertResult {
  config: Partial<PubmConfig>;
  warnings: string[];
  changesetFiles?: string[];
}

export interface MigrationSource {
  name: MigrationSourceName;
  configFilePatterns: string[];
  detect(cwd: string): Promise<DetectResult>;
  parse(files: string[], cwd: string): Promise<ParsedMigrationConfig>;
  convert(parsed: ParsedMigrationConfig): ConvertResult;
  getCleanupTargets(detected: DetectResult): string[];
}

export interface MigrationOptions {
  cwd: string;
  from?: MigrationSourceName;
  clean?: boolean;
  dryRun?: boolean;
}

export interface MigrationPipelineResult {
  source: MigrationSourceName;
  configWritten: boolean;
  cleanedFiles: string[];
  warnings: string[];
  ciAdvice: CiAdvice[];
}

export interface CiAdvice {
  file: string;
  removeLine: string;
  addLine: string;
}
