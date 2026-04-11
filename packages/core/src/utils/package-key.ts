import type { EcosystemKey } from "../ecosystem/catalog.js";

export function packageKey(pkg: {
  path: string;
  ecosystem: EcosystemKey;
}): string {
  return `${pkg.path}::${pkg.ecosystem}`;
}
