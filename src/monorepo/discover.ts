import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import micromatch from "micromatch";
import type { PackageConfig } from "../config/types.js";
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

const defaultRegistries: Record<EcosystemType, RegistryType[]> = {
  js: ["npm", "jsr"],
  rust: ["crates"],
};

function detectEcosystem(packageDir: string): EcosystemType | null {
  if (existsSync(path.join(packageDir, "package.json"))) return "js";
  if (existsSync(path.join(packageDir, "Cargo.toml"))) return "rust";
  return null;
}

function matchesIgnore(pkgPath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => {
    const regex = new RegExp(
      `^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`,
    );
    return regex.test(pkgPath);
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

export function discoverPackages(options: DiscoverOptions): DiscoveredPackage[] {
  const { cwd, ignore = [], configPackages = [] } = options;

  const workspace = detectWorkspace(cwd);
  const discovered = new Map<string, DiscoveredPackage>();

  if (workspace && workspace.patterns.length > 0) {
    const dirs = resolvePatterns(cwd, workspace.patterns);

    for (const dir of dirs) {
      const relativePath = path.relative(cwd, dir);
      if (matchesIgnore(relativePath, ignore)) continue;

      const ecosystem = detectEcosystem(dir);
      if (!ecosystem) continue;

      discovered.set(relativePath, {
        path: relativePath,
        registries: defaultRegistries[ecosystem],
        ecosystem,
      });
    }
  }

  // Merge config packages (config overrides auto-detected)
  for (const configPkg of configPackages) {
    const existing = discovered.get(configPkg.path);

    if (existing) {
      discovered.set(configPkg.path, {
        ...existing,
        registries: configPkg.registries ?? existing.registries,
        ecosystem: configPkg.ecosystem ?? existing.ecosystem,
      });
    } else {
      const absPath = path.join(cwd, configPkg.path);
      const ecosystem = configPkg.ecosystem ?? detectEcosystem(absPath);

      if (ecosystem) {
        discovered.set(configPkg.path, {
          path: configPkg.path,
          registries: configPkg.registries ?? defaultRegistries[ecosystem],
          ecosystem,
        });
      }
    }
  }

  return Array.from(discovered.values());
}
