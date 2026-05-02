import type { ReleasePrScope } from "./scope.js";

export const RELEASE_PR_BODY_MARKER = "<!-- pubm:release-pr -->";
export const RELEASE_PR_METADATA_MARKER = "pubm:release-pr-metadata";
export const RELEASE_PR_METADATA_SCHEMA_VERSION = 1;

export interface ReleasePrBodyMetadata {
  isReleasePr: boolean;
  scopeId?: string;
  packageKeys: string[];
  schemaVersion?: 1;
}

interface ReleasePrMetadataPayload {
  schemaVersion: 1;
  scopeId: string;
  scopeKind: ReleasePrScope["kind"];
  scopeSlug: string;
  displayName: string;
  packageKeys: string[];
}

export function renderReleasePrMetadataMarker(scope: ReleasePrScope): string {
  const payload: ReleasePrMetadataPayload = {
    schemaVersion: RELEASE_PR_METADATA_SCHEMA_VERSION,
    scopeId: scope.id,
    scopeKind: scope.kind,
    scopeSlug: scope.slug,
    displayName: scope.displayName,
    packageKeys: [...scope.packageKeys].sort(),
  };

  return `<!-- ${RELEASE_PR_METADATA_MARKER} ${JSON.stringify(payload)} -->`;
}

export function parseReleasePrBodyMetadata(
  body: string | undefined | null,
): ReleasePrBodyMetadata {
  if (!body?.includes(RELEASE_PR_BODY_MARKER)) {
    return { isReleasePr: false, packageKeys: [] };
  }

  const metadata = extractMetadataPayload(body);
  if (!metadata) {
    return { isReleasePr: true, packageKeys: [] };
  }

  return metadata;
}

export function sameReleasePrScope(
  scope: ReleasePrScope,
  metadata: ReleasePrBodyMetadata,
): boolean {
  if (!metadata.isReleasePr) return false;
  if (metadata.scopeId && metadata.scopeId === scope.id) return true;
  return sameStringSet(scope.packageKeys, metadata.packageKeys);
}

function extractMetadataPayload(
  body: string,
): ReleasePrBodyMetadata | undefined {
  const pattern = new RegExp(
    `<!--\\s*${escapeRegExp(RELEASE_PR_METADATA_MARKER)}\\s+(.+?)\\s*-->`,
  );
  const match = body.match(pattern);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1]) as Partial<ReleasePrMetadataPayload>;
    if (parsed.schemaVersion !== RELEASE_PR_METADATA_SCHEMA_VERSION) {
      return undefined;
    }

    return {
      isReleasePr: true,
      schemaVersion: RELEASE_PR_METADATA_SCHEMA_VERSION,
      ...(typeof parsed.scopeId === "string"
        ? { scopeId: parsed.scopeId }
        : {}),
      packageKeys: Array.isArray(parsed.packageKeys)
        ? parsed.packageKeys
            .filter((key): key is string => typeof key === "string")
            .sort()
        : [],
    };
  } catch {
    return undefined;
  }
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
