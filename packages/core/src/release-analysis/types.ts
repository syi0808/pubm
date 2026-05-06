import type { BumpType } from "../changeset/parser.js";
import type { VersionRecommendation } from "../version-source/types.js";

export type UnversionedChangeReason =
  | "non-conventional"
  | "ignored-type"
  | "unmatched-package";

export interface UnversionedChange {
  hash: string;
  summary: string;
  files: string[];
  reason: UnversionedChangeReason;
  packagePath?: string;
  type?: string;
}

export interface ReleaseAnalysis {
  recommendations: VersionRecommendation[];
  unversionedChanges: UnversionedChange[];
}

export interface ReleaseAnalysisSummary {
  packagePath: string;
  bumpType: BumpType;
  source: string;
}
