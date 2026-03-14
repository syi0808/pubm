import path from "node:path";
import type { PackageConfig } from "../config/types.js";
import { AbstractError } from "../error.js";
import { findOutFile } from "../utils/package.js";
import { JsEcosystem } from "./js.js";
import { RustEcosystem } from "./rust.js";

/**
 * Write version to manifest files at the given package path.
 * Auto-detects the ecosystem and writes to the appropriate manifest files.
 * Returns the list of modified file paths.
 */
export async function writeVersionAtPath(
  version: string,
  packagePath: string,
): Promise<string[]> {
  const files: string[] = [];

  // Try JS ecosystem
  if (await JsEcosystem.detect(packagePath)) {
    const eco = new JsEcosystem(packagePath);
    await eco.writeVersion(version);
    files.push(path.join(packagePath, "package.json"));

    // jsr.json is also written by JsEcosystem.writeVersion if it exists
    const jsrJsonPath = path.join(packagePath, "jsr.json");
    try {
      const { stat } = await import("node:fs/promises");
      if ((await stat(jsrJsonPath)).isFile()) {
        files.push(jsrJsonPath);
      }
    } catch {
      // jsr.json doesn't exist
    }
  }

  // Try Rust ecosystem
  if (await RustEcosystem.detect(packagePath)) {
    const eco = new RustEcosystem(packagePath);
    await eco.writeVersion(version);
    files.push(path.join(packagePath, "Cargo.toml"));
  }

  return files;
}

/**
 * Write version to all configured packages' manifest files.
 * For single-package (no packages config), writes to cwd manifest files.
 * Handles Rust crate sibling dependency updates and lockfile syncing.
 * Returns the list of modified file paths.
 */
export async function writeVersionForPackages(
  version: string,
  packages?: PackageConfig[],
): Promise<string[]> {
  const allFiles: string[] = [];

  // Write JS manifests at cwd (for the root/single package)
  const results = await Promise.all([
    (async () => {
      const packageJsonPath = await findOutFile("package.json");
      if (!packageJsonPath) return undefined;

      const dir = path.dirname(packageJsonPath);
      const eco = new JsEcosystem(dir);
      try {
        await eco.writeVersion(version);
      } catch (error) {
        throw new AbstractError(
          `Failed to write version to package.json: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }
      return "package.json";
    })(),
    (async () => {
      const jsrJsonPath = await findOutFile("jsr.json");
      if (!jsrJsonPath) return undefined;
      // jsr.json was already written by JsEcosystem.writeVersion above
      // if it's in the same directory. But if it's standalone we still report it.
      return "jsr.json";
    })(),
  ]);

  for (const r of results) {
    if (r) allFiles.push(r);
  }

  // Handle Rust crates separately — sibling deps must be updated sequentially
  const cratePackages = (packages ?? []).filter((pkg) =>
    pkg.registries?.includes("crates"),
  );

  if (cratePackages.length > 0) {
    const ecosystems: { eco: RustEcosystem; pkg: PackageConfig }[] = [];

    // Phase 1: Write versions to all crate Cargo.tomls
    for (const pkg of cratePackages) {
      const eco = new RustEcosystem(path.resolve(pkg.path));
      try {
        await eco.writeVersion(version);
      } catch (error) {
        throw new AbstractError(
          `Failed to write version to Cargo.toml at ${pkg.path}: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }
      ecosystems.push({ eco, pkg });
    }

    // Phase 2: Update sibling dependency versions
    if (ecosystems.length > 1) {
      const siblingVersions = new Map<string, string>();
      for (const { eco } of ecosystems) {
        siblingVersions.set(await eco.packageName(), version);
      }

      await Promise.all(
        ecosystems.map(({ eco }) =>
          eco.updateSiblingDependencyVersions(siblingVersions),
        ),
      );
    }

    // Phase 3: Sync lockfiles
    for (const { eco, pkg } of ecosystems) {
      allFiles.push(path.join(pkg.path, "Cargo.toml"));
      try {
        const lockfilePath = await eco.syncLockfile();
        if (lockfilePath) allFiles.push(lockfilePath);
      } catch (error) {
        throw new AbstractError(
          `Failed to sync Cargo.lock at ${pkg.path}: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }
    }
  }

  return [...new Set(allFiles)];
}
