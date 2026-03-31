import type { BumpType } from "../changeset/parser.js";

export interface ConventionalCommit {
  hash: string;
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
  body?: string;
  footers: Map<string, string>;
  files: string[];
}

export type CommitTypeMapping = Record<string, BumpType | false>;

export const DEFAULT_TYPE_BUMP_MAP: CommitTypeMapping = {
  feat: "minor",
  fix: "patch",
  perf: "patch",
  chore: false,
  docs: false,
  test: false,
  ci: false,
  style: false,
  refactor: false,
};

export const COMMIT_TYPE_CATEGORY_MAP: Record<string, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  perf: "Performance",
  refactor: "Refactoring",
  docs: "Documentation",
};

export const DEFAULT_CATEGORY = "Other Changes";
