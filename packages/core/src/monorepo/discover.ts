import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import type { PackageConfig } from "../config/types.js";
import { type EcosystemKey, ecosystemCatalog } from "../ecosystem/catalog.js";
import { inferRegistries } from "../ecosystem/infer.js";
import type { RegistryType } from "../types/options.js";
import { detectWorkspace } from "./workspace.js";

export interface DiscoverOptions {
  cwd: string;
  ignore?: string[];
  configPackages?: PackageConfig[];
}

export interface ResolvedPackage {
  name: string;
  version: string;
  path: string;
  ecosystem: EcosystemKey;
  registries: RegistryType[];
  dependencies: string[];
  registryVersions?: Map<RegistryType, string>;
}

/** @deprecated Use ResolvedPackage instead. Will be removed in a future version. */
export type DiscoveredPackage = ResolvedPackage;

interface DiscoverTarget {
  path: string;
  ecosystem?: string;
  registries?: RegistryType[];
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

function matchesIgnore(pkgPath: string, ignorePatterns: string[]): boolean {
  const normalized = toForwardSlash(pkgPath);
  return ignorePatterns.some((pattern) => {
    const regex = new RegExp(
      `^${toForwardSlash(pattern).replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
    );
    return regex.test(normalized);
  });
}

function resolvePatterns(cwd: string, patterns: string[]): string[] {
  const entries = readdirSync(cwd, { recursive: true, encoding: "utf-8" });

  const dirs = entries.filter((entry) => {
    const fullPath = path.join(cwd, entry);
    try {
      return statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });

  // Normalize separators for matching on Windows
  const normalizedDirs = dirs.map((d) => d.replace(/\\/g, "/"));
  const matched = micromatch(normalizedDirs, patterns);

  return matched.map((d) => path.resolve(cwd, d));
}

async function discoverFromWorkspace(
  cwd: string,
  ignore: string[],
): Promise<DiscoverTarget[]> {
  const workspaces = detectWorkspace(cwd);
  const targets: DiscoverTarget[] = [];
  const seen = new Set<string>();

  for (const workspace of workspaces) {
    if (workspace.patterns.length === 0) continue;

    const dirs = resolvePatterns(cwd, workspace.patterns);

    // Resolve exclude patterns for Cargo workspaces
    const excludedDirs = workspace.exclude?.length
      ? new Set(
          resolvePatterns(cwd, workspace.exclude).map((d) =>
            toForwardSlash(path.relative(cwd, d)),
          ),
        )
      : new Set<string>();

    for (const dir of dirs) {
      const relativePath = path.relative(cwd, dir);
      const normalizedRelative = toForwardSlash(relativePath);

      if (excludedDirs.has(normalizedRelative)) continue;
      if (matchesIgnore(relativePath, ignore)) continue;
      if (seen.has(normalizedRelative)) continue;

      seen.add(normalizedRelative);
      targets.push({ path: relativePath });
    }
  }

  return targets;
}

async function resolvePackage(
  cwd: string,
  target: DiscoverTarget,
): Promise<ResolvedPackage | null> {
  const absPath = path.resolve(cwd, target.path);

  // Detect or use explicit ecosystem
  let descriptor:
    | import("../ecosystem/catalog.js").EcosystemDescriptor
    | null
    | undefined;
  if (target.ecosystem) {
    descriptor = ecosystemCatalog.get(target.ecosystem);
  } else {
    descriptor = await ecosystemCatalog.detect(absPath);
  }

  if (!descriptor) return null;

  const ecosystemKey = descriptor.key;
  const ecosystem = new descriptor.ecosystemClass(absPath);

  // Read manifest for name, version, private, dependencies
  let manifest: {
    name: string;
    version: string;
    private: boolean;
    dependencies: string[];
  };
  try {
    manifest = await ecosystem.readManifest();
  } catch {
    return null;
  }

  // Filter private packages
  if (manifest.private) return null;

  // Read registry versions for mismatch detection
  const registryVersions = await ecosystem.readRegistryVersions();
  const versionValues = [...registryVersions.values()];
  const hasVersionMismatch =
    versionValues.length > 1 &&
    !versionValues.every((v) => v === versionValues[0]);

  // Determine registries
  const registries =
    target.registries ?? (await inferRegistries(absPath, ecosystemKey, cwd));

  return {
    name: manifest.name,
    version: manifest.version,
    path: target.path,
    ecosystem: ecosystemKey,
    registries,
    dependencies: manifest.dependencies,
    ...(hasVersionMismatch ? { registryVersions } : {}),
  };
}

export async function discoverPackages(
  options: DiscoverOptions,
): Promise<ResolvedPackage[]> {
  const { cwd, ignore = [], configPackages = [] } = options;

  // When configPackages is provided and non-empty, skip workspace discovery
  if (configPackages.length > 0) {
    const targets: DiscoverTarget[] = configPackages.map((pkg) => ({
      path: path.normalize(pkg.path),
      ecosystem: pkg.ecosystem,
      registries: pkg.registries as RegistryType[] | undefined,
    }));

    const results = await Promise.all(
      targets.map((target) => resolvePackage(cwd, target)),
    );

    return results.filter((r): r is ResolvedPackage => r !== null);
  }

  // Workspace discovery
  const targets = await discoverFromWorkspace(cwd, ignore);

  // Single-package fallback: when no workspaces found, treat cwd as a single package
  if (targets.length === 0) {
    const workspaces = detectWorkspace(cwd);
    if (workspaces.length === 0) {
      const result = await resolvePackage(cwd, { path: "." });
      return result ? [result] : [];
    }
  }

  // Resolve each target in parallel
  const results = await Promise.all(
    targets.map((target) => resolvePackage(cwd, target)),
  );

  return results.filter((r): r is ResolvedPackage => r !== null);
}
