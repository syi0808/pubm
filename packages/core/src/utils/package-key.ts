import type { EcosystemKey } from "../ecosystem/catalog.js";

export function packageKey(pkg: {
  path: string;
  ecosystem: EcosystemKey;
}): string {
  return `${pkg.path}::${pkg.ecosystem}`;
}

/**
 * Extract the filesystem path from a packageKey string (path::ecosystem).
 * If the key contains no "::" separator, returns the key unchanged.
 * If key is undefined or empty, returns an empty string.
 */
export function pathFromKey(key: string | undefined): string {
  if (!key) return "";
  const sep = key.lastIndexOf("::");
  return sep === -1 ? key : key.slice(0, sep);
}
