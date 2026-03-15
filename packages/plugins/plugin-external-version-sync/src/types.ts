export interface JsonTarget {
  file: string;
  jsonPath: string;
}

export interface RegexTarget {
  file: string;
  pattern: RegExp;
}

export type SyncTarget = JsonTarget | RegexTarget;

export interface ExternalVersionSyncOptions {
  targets: SyncTarget[];
  version?: (packages: Map<string, string>) => string;
}

export function isJsonTarget(target: SyncTarget): target is JsonTarget {
  return "jsonPath" in target;
}

export function isRegexTarget(target: SyncTarget): target is RegexTarget {
  return "pattern" in target;
}
