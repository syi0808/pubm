import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import { parse as parseToml } from "smol-toml";
import type { PackageConfig } from "../config/types.js";
import { ecosystemCatalog } from "../ecosystem/catalog.js";
import { inferRegistries } from "../ecosystem/infer.js";
import type { RegistryType } from "../types/options.js";
import { detectWorkspace } from "./workspace.js";

type EcosystemType = "js" | "rust";

export interface DiscoverOptions {
  cwd: string;
  ignore?: string[];
  configPackages?: PackageConfig[];
}

export interface DiscoveredPackage {
  path: string;
  registries: RegistryType[];
  ecosystem: EcosystemType;
}

function detectEcosystem(packageDir: string): EcosystemType | null {
  for (const descriptor of ecosystemCatalog.all()) {
    const eco = new descriptor.ecosystemClass(packageDir);
    const manifests = eco.manifestFiles();
    if (manifests.some((m) => existsSync(path.join(packageDir, m)))) {
      return descriptor.key as EcosystemType;
    }
  }
  return null;
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

function isPrivatePackage(
  packageDir: string,
  ecosystem: EcosystemType,
): boolean {
  try {
    if (ecosystem === "js") {
      const pkgJsonPath = path.join(packageDir, "package.json");
      if (existsSync(pkgJsonPath)) {
        const content = readFileSync(pkgJsonPath, "utf-8");
        const pkg = JSON.parse(content);
        return pkg.private === true;
      }
    } else if (ecosystem === "rust") {
      const cargoPath = path.join(packageDir, "Cargo.toml");
      if (existsSync(cargoPath)) {
        const content = readFileSync(cargoPath, "utf-8");
        const parsed = parseToml(content);
        const pkgSection = parsed.package as
          | { publish?: boolean | string[] }
          | undefined;
        if (pkgSection?.publish === false) return true;
        if (
          Array.isArray(pkgSection?.publish) &&
          pkgSection.publish.length === 0
        )
          return true;
      }
    }
  } catch {
    // If we can't read/parse the manifest, assume it's publishable
  }
  return false;
}

export async function discoverPackages(
  options: DiscoverOptions,
): Promise<DiscoveredPackage[]> {
  const { cwd, ignore = [], configPackages = [] } = options;

  const workspaces = detectWorkspace(cwd);
  const discovered = new Map<string, DiscoveredPackage>();

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

      const ecosystem = detectEcosystem(dir);
      if (!ecosystem) continue;

      if (isPrivatePackage(dir, ecosystem)) continue;

      discovered.set(normalizedRelative, {
        path: relativePath,
        registries: await inferRegistries(dir, ecosystem, cwd),
        ecosystem,
      });
    }
  }

  // Single-package fallback: when no workspaces and no config packages,
  // treat cwd as a single package
  if (workspaces.length === 0 && configPackages.length === 0) {
    const ecosystem = detectEcosystem(cwd);
    if (ecosystem && !isPrivatePackage(cwd, ecosystem)) {
      return [
        {
          path: ".",
          registries: await inferRegistries(cwd, ecosystem, cwd),
          ecosystem,
        },
      ];
    }
    return [];
  }

  // Merge config packages (config overrides auto-detected)
  for (const configPkg of configPackages) {
    const key = toForwardSlash(configPkg.path);
    const nativePath = path.normalize(configPkg.path);
    const existing = discovered.get(key);

    if (existing) {
      discovered.set(key, {
        ...existing,
        registries: (configPkg.registries ??
          existing.registries) as RegistryType[],
        ecosystem: configPkg.ecosystem ?? existing.ecosystem,
      });
    } else {
      const absPath = path.join(cwd, configPkg.path);
      const ecosystem = configPkg.ecosystem ?? detectEcosystem(absPath);

      if (ecosystem) {
        discovered.set(key, {
          path: nativePath,
          registries: (configPkg.registries ??
            (await inferRegistries(absPath, ecosystem, cwd))) as RegistryType[],
          ecosystem,
        });
      }
    }
  }

  return Array.from(discovered.values());
}
