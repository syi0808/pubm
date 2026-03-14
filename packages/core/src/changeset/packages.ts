import path from "node:path";
import { discoverPackages } from "../monorepo/discover.js";
import { NpmRegistry } from "../registry/npm.js";

export interface PackageVersionInfo {
  name: string;
  version: string;
  path: string;
}

export async function discoverCurrentVersions(
  cwd: string,
): Promise<Map<string, string>> {
  const discovered = await discoverPackages({ cwd });
  const versions = new Map<string, string>();

  if (discovered.length > 0) {
    for (const pkg of discovered) {
      const pkgCwd = path.resolve(cwd, pkg.path);
      try {
        const manifest = await NpmRegistry.reader.read(pkgCwd);
        versions.set(manifest.name || pkg.path, manifest.version || "0.0.0");
      } catch {
        versions.set(pkg.path, "0.0.0");
      }
    }
  } else {
    try {
      const manifest = await NpmRegistry.reader.read(cwd);
      versions.set(manifest.name || "unknown", manifest.version || "0.0.0");
    } catch {
      versions.set("unknown", "0.0.0");
    }
  }

  return versions;
}

export async function discoverPackageInfos(
  cwd: string,
): Promise<PackageVersionInfo[]> {
  const discovered = await discoverPackages({ cwd });
  const infos: PackageVersionInfo[] = [];

  if (discovered.length > 0) {
    for (const pkg of discovered) {
      const pkgCwd = path.resolve(cwd, pkg.path);
      try {
        const manifest = await NpmRegistry.reader.read(pkgCwd);
        infos.push({
          name: manifest.name || pkg.path,
          version: manifest.version || "0.0.0",
          path: pkg.path,
        });
      } catch {
        infos.push({ name: pkg.path, version: "0.0.0", path: pkg.path });
      }
    }
  } else {
    try {
      const manifest = await NpmRegistry.reader.read(cwd);
      infos.push({
        name: manifest.name || "unknown",
        version: manifest.version || "0.0.0",
        path: ".",
      });
    } catch {
      infos.push({ name: "unknown", version: "0.0.0", path: "." });
    }
  }

  return infos;
}
