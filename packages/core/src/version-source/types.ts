import type { BumpType } from "../changeset/parser.js";

export interface VersionSourceContext {
  cwd: string;
  packages: Map<string, string>;
  resolveKey?: (name: string) => string;
}

export interface VersionEntry {
  summary: string;
  type?: string;
  hash?: string;
  id?: string;
}

export interface VersionRecommendation {
  packagePath: string;
  bumpType: BumpType;
  source: string;
  entries: VersionEntry[];
}

export interface VersionSource {
  readonly name: string;
  analyze(context: VersionSourceContext): Promise<VersionRecommendation[]>;
  consume?(recommendations: VersionRecommendation[]): Promise<void>;
}
