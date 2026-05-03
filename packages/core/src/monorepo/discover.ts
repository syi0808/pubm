import { lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import type { PackageConfig } from "../config/types.js";
import { type EcosystemKey, ecosystemCatalog } from "../ecosystem/catalog.js";
import { inferRegistries } from "../ecosystem/infer.js";
import { registryCatalog } from "../registry/catalog.js";
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

interface DiscoverTarget {
  path: string;
  ecosystem?: string;
  registries?: RegistryType[];
}

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, "/");
}

function isGlobPattern(pattern: string): boolean {
  return micromatch.scan(pattern).isGlob;
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

function readdirRecursiveNoSymlinks(dir: string, root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir, { encoding: "utf-8" });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git") continue;
    const fullPath = path.join(dir, entry);
    try {
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        results.push(path.relative(root, fullPath));
        results.push(...readdirRecursiveNoSymlinks(fullPath, root));
      }
    } catch {
      // skip inaccessible entries
    }
  }
  return results;
}

export function resolvePatterns(cwd: string, patterns: string[]): string[] {
  const dirs = readdirRecursiveNoSymlinks(cwd, cwd);

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
      const normalizedRelative = toForwardSlash(path.relative(cwd, dir));

      if (excludedDirs.has(normalizedRelative)) continue;
      if (matchesIgnore(normalizedRelative, ignore)) continue;
      if (seen.has(normalizedRelative)) continue;

      seen.add(normalizedRelative);
      targets.push({ path: normalizedRelative });
    }
  }

  return targets;
}

async function resolvePackages(
  cwd: string,
  target: DiscoverTarget,
): Promise<ResolvedPackage[]> {
  const absPath = path.resolve(cwd, target.path);

  let descriptors: import("../ecosystem/catalog.js").EcosystemDescriptor[] = [];

  if (target.ecosystem) {
    const desc = ecosystemCatalog.get(target.ecosystem);
    if (desc) descriptors = [desc];
  } else if (target.registries && target.registries.length > 0) {
    const detected = await ecosystemCatalog.detectAll(absPath);
    const registryEcosystems = new Set(
      target.registries
        .map((r) => registryCatalog.get(r)?.ecosystem)
        .filter((e): e is EcosystemKey => e !== undefined),
    );
    descriptors = detected.filter((d) => registryEcosystems.has(d.key));
  } else {
    descriptors = await ecosystemCatalog.detectAll(absPath);
  }

  const results: ResolvedPackage[] = [];

  for (const descriptor of descriptors) {
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
      continue;
    }

    // Filter private packages
    if (manifest.private) continue;

    // Read registry versions for mismatch detection
    const registryVersions = await ecosystem.readRegistryVersions();
    const versionValues = [...registryVersions.values()];
    const hasVersionMismatch =
      versionValues.length > 1 &&
      !versionValues.every((v) => v === versionValues[0]);

    // Determine registries
    const registries = target.registries
      ? target.registries.filter(
          (r) => registryCatalog.get(r)?.ecosystem === ecosystemKey,
        )
      : await inferRegistries(absPath, ecosystemKey, cwd);

    results.push({
      name: manifest.name,
      version: manifest.version,
      path: target.path,
      ecosystem: ecosystemKey,
      registries,
      dependencies: manifest.dependencies,
      ...(hasVersionMismatch ? { registryVersions } : {}),
    });
  }

  return results;
}

export async function discoverPackages(
  options: DiscoverOptions,
): Promise<ResolvedPackage[]> {
  const { cwd, ignore = [], configPackages = [] } = options;

  // When configPackages is provided and non-empty, skip workspace discovery
  if (configPackages.length > 0) {
    const targets: DiscoverTarget[] = configPackages.flatMap((pkg) => {
      if (isGlobPattern(pkg.path)) {
        const resolved = resolvePatterns(cwd, [pkg.path]);
        return resolved.map((absPath) => ({
          path: toForwardSlash(path.relative(cwd, absPath)),
          ecosystem: pkg.ecosystem,
          registries: pkg.registries as RegistryType[] | undefined,
        }));
      }
      return {
        path: toForwardSlash(path.normalize(pkg.path)),
        ecosystem: pkg.ecosystem,
        registries: pkg.registries as RegistryType[] | undefined,
      };
    });

    const results = await Promise.all(
      targets.map((target) => resolvePackages(cwd, target)),
    );

    return results.flat();
  }

  // Workspace discovery
  const targets = await discoverFromWorkspace(cwd, ignore);

  // Single-package fallback: when no workspaces found, treat cwd as a single package
  if (targets.length === 0) {
    const workspaces = detectWorkspace(cwd);
    if (workspaces.length === 0) {
      return await resolvePackages(cwd, { path: "." });
    }
  }

  // Resolve each target in parallel
  const results = await Promise.all(
    targets.map((target) => resolvePackages(cwd, target)),
  );

  return results.flat();
}
